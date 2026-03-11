(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ItalianAddressMap = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    class ItalianAddressMap {
        constructor(mapElementId, client, options = {}) {
            if (typeof L === 'undefined') {
                throw new Error('Leaflet (L) is required but not found.');
            }
            this.client = client;
            this.options = {
                center: [41.9028, 12.4964], // Rome
                zoom: 13,
                ...options
            };

            this.map = L.map(mapElementId).setView(this.options.center, this.options.zoom);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors'
            }).addTo(this.map);

            this.selectionLayer = L.layerGroup().addTo(this.map);
            this.candidateLayer = L.layerGroup().addTo(this.map);
            this.isPickMode = false;
            
            this._addControlButtons();
            this._setupEvents();
        }

        _addControlButtons() {
            const PickControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: (map) => {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
                    const button = L.DomUtil.create('a', 'anncsu-pick-btn', container);
                    button.innerHTML = '<i class=\"pi pi-map-marker\"></i>';
                    button.title = 'Seleziona da mappa';
                    button.style.cursor = 'pointer';
                    button.style.backgroundColor = '#fff';
                    button.style.fontSize = '1.2rem';
                    button.style.display = 'flex';
                    button.style.alignItems = 'center';
                    button.style.justifyContent = 'center';

                    L.DomEvent.disableClickPropagation(container);
                    L.DomEvent.on(button, 'click', (e) => {
                        this.isPickMode = !this.isPickMode;
                        button.style.color = this.isPickMode ? '#0056b3' : '#333';
                        button.style.backgroundColor = this.isPickMode ? '#e7f4e4' : '#fff';
                        this.map.getContainer().style.cursor = this.isPickMode ? 'crosshair' : '';
                        if (!this.isPickMode) this.candidateLayer.clearLayers();
                    });
                    return container;
                }
            });
            this.map.addControl(new PickControl());
        }

        _setupEvents() {
            this.map.on('click', async (e) => {
                if (!this.isPickMode) return;
                const { lat, lng } = e.latlng;
                await this.searchNearby(lat, lng);
            });
        }

        /**
         * Search for nearby addresses and display them as candidates.
         */
        async searchNearby(lat, lon, maxDistance = 150) {
            try {
                const results = await this.client._fetch('rpc/search_nearby_addresses', {
                    lat, lon, max_distance_meters: maxDistance
                });

                this.candidateLayer.clearLayers();
                if (results && results.length > 0) {
                    const points = results.map((addr, index) => {
                        const marker = L.circleMarker([addr.latitude, addr.longitude], {
                            radius: 8,
                            fillColor: index === 0 ? "#22c55e" : "#94a3b8",
                            color: "#fff",
                            weight: 2,
                            opacity: 1,
                            fillOpacity: 0.8
                        }).addTo(this.candidateLayer);

                        const popupContent = `
                            <div style=\"padding: 5px\">
                                <strong>${addr.street_name}, ${addr.full_number}</strong><br>
                                <small>${addr.municipality}</small><br>
                                <button class=\"anncsu-confirm-btn\" onclick=\"window._anncsuConfirm('${addr.id}')\" style=\"margin-top:8px; cursor:pointer\">Usa questo indirizzo</button>
                            </div>
                        `;
                        marker.bindPopup(popupContent);
                        if (index === 0) marker.openPopup();
                        return marker;
                    });

                    window._anncsuConfirm = (id) => {
                        const selected = results.find(r => r.id == id);
                        if (selected) {
                            this.candidateLayer.clearLayers();
                            this.isPickMode = false;
                            this.map.getContainer().style.cursor = '';
                            // Find and update the control button color
                            const btn = this.map.getContainer().querySelector('.anncsu-pick-btn');
                            if (btn) { btn.style.color = '#333'; btn.style.backgroundColor = '#fff'; }
                            
                            if (this.onAddressSelected) this.onAddressSelected(selected);
                            this.showAddress(selected);
                        }
                    };
                }
            } catch (err) {
                console.error('Error during reverse geocoding:', err);
            }
        }

        /**
         * Show all addresses for a specific street.
         */
        async showStreetAddresses(streetId) {
            try {
                const addresses = await this.client._fetch('addresses', {
                    street_id: `eq.${streetId}`,
                    limit: 1000
                });

                this.selectionLayer.clearLayers();
                if (addresses && addresses.length > 0) {
                    addresses.forEach(addr => {
                        L.circleMarker([addr.latitude, addr.longitude], {
                            radius: 4,
                            fillColor: "#0056b3",
                            color: "#fff",
                            weight: 1,
                            opacity: 0.6,
                            fillOpacity: 0.4
                        }).addTo(this.selectionLayer).bindPopup(`<strong>${addr.full_number}</strong>`);
                    });
                }
            } catch (err) {
                console.error('Error fetching street addresses:', err);
            }
        }

        /**
         * Highlight the officially selected address.
         */
        showAddress(address) {
            this.selectionLayer.clearLayers();
            if (address && address.latitude && address.longitude) {
                const marker = L.marker([address.latitude, address.longitude]).addTo(this.selectionLayer);
                marker.bindPopup(`<strong>${address.full_number || 'Selezionato'}</strong>`).openPopup();
                this.map.setView([address.latitude, address.longitude], 18);
            }
        }

        clearMarkers() {
            this.markers.clearLayers();
        }

        /**
         * High-level sync method to automatically update the map based on client selection.
         */
        syncWithClient(config = {}) {
            const defaultOnStreet = this.options.showAllStreetPoints !== false;
            
            // We can wrap the client's existing callbacks or use the onStateChange if available
            const originalOnStreet = this.client._callbacks.onStreetChange;
            this.client._callbacks.onStreetChange = (street) => {
                if (originalOnStreet) originalOnStreet(street);
                if (street && defaultOnStreet) this.showStreetAddresses(street.id);
            };

            const originalOnAddress = this.client._callbacks.onAddressChange;
            this.client._callbacks.onAddressChange = (address) => {
                if (originalOnAddress) originalOnAddress(address);
                if (address) this.showAddress(address);
            };
        }
    }

    return ItalianAddressMap;
}));
