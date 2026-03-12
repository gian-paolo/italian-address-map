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
        static version = '1.2.2';

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
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(this.map);

            this.selectionLayer = L.layerGroup().addTo(this.map);
            this.candidateLayer = L.layerGroup().addTo(this.map);
            this.isPickMode = false;
            
            this.currentStreetAddresses = null;
            this.currentNearbyResults = null;
            this._lastTextMode = null;
            this._coordsRegistry = {};
            
            this._addControlButtons();
            this._setupEvents();
        }

        _addControlButtons() {
            const PickControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: (map) => {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
                    const button = L.DomUtil.create('a', 'anncsu-pick-btn', container);
                    button.innerHTML = '<i class="pi pi-map-marker"></i>';
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
                        if (!this.isPickMode) {
                            this.candidateLayer.clearLayers();
                            this.currentNearbyResults = null;
                        }
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
                this.currentNearbyResults = results;
                this._coordsRegistry = {}; // Reset for de-collision
                
                if (results && results.length > 0) {
                    const currentZoom = this.map.getZoom();
                    results.forEach((addr, index) => {
                        this._addCandidateToMap(addr, index, currentZoom);
                    });

                    window._anncsuConfirm = (id) => {
                        const selected = this.currentNearbyResults.find(r => r.id == id);
                        if (selected) {
                            this.candidateLayer.clearLayers();
                            this.currentNearbyResults = null;
                            this.isPickMode = false;
                            this.map.getContainer().style.cursor = '';
                            const btn = this.map.getContainer().querySelector('.anncsu-pick-btn');
                            if (btn) { btn.style.color = '#333'; btn.style.backgroundColor = '#fff'; }
                            
                            if (this.onAddressSelected) this.onAddressSelected(selected);
                            this.showAddress(selected);
                        }
                    };

                    if (!this._zoomListenerAdded) {
                        this.map.on('zoomend', () => this._updateAddressMarkers());
                        this._zoomListenerAdded = true;
                    }
                }
            } catch (err) {
                console.error('Error during reverse geocoding:', err);
            }
        }

        _addCandidateToMap(addr, index, zoomLevel) {
            const type = index === 0 ? 'candidate-prime' : 'candidate';
            const marker = this._createAddressMarker(addr, zoomLevel, type);
            marker.addTo(this.candidateLayer);

            const popupContent = `
                <div style="padding: 5px">
                    <strong>${addr.street_name || ''}, ${addr.full_number}</strong><br>
                    <small>${addr.municipality || ''}</small><br>
                    <button class="anncsu-confirm-btn" onclick="window._anncsuConfirm('${addr.id}')" style="margin-top:8px; cursor:pointer">Usa questo indirizzo</button>
                </div>
            `;
            marker.bindPopup(popupContent);
            if (index === 0 && !this._isZooming) marker.openPopup();
            return marker;
        }

        /**
         * Show all addresses for a specific street.
         */
        async showStreetAddresses(streetId) {
            try {
                const addresses = await this.client._fetch('addresses', {
                    street_id: `eq.${streetId}`,
                    latitude: 'not.is.null',
                    limit: 1000
                });

                this.selectionLayer.clearLayers();
                this._coordsRegistry = {};
                
                if (!addresses || addresses.length === 0) {
                    this.currentStreetAddresses = null;
                    return;
                }

                this.currentStreetAddresses = addresses;
                const currentZoom = this.map.getZoom();
                this._lastTextMode = currentZoom >= 18;
                
                const markers = [];

                addresses.forEach(addr => {
                    if (!addr.latitude || !addr.longitude) return;
                    const marker = this._createAddressMarker(addr, currentZoom, 'street');
                    marker.addTo(this.selectionLayer);
                    markers.push(marker);
                });

                if (markers.length > 0) {
                    const bounds = L.latLngBounds(markers.map(m => m.getLatLng()));
                    this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
                }

                if (!this._zoomListenerAdded) {
                    this.map.on('zoomend', () => this._updateAddressMarkers());
                    this._zoomListenerAdded = true;
                }
            } catch (err) {
                console.error('Error fetching street addresses:', err);
            }
        }

        _createAddressMarker(addr, zoomLevel, type = 'street') {
            let lat = parseFloat(addr.latitude);
            let lng = parseFloat(addr.longitude);
            const numberText = addr.full_number || addr.number || 'SNC';

            // De-collision logic (Jittering for identical coordinates)
            const coordKey = `${lat.toFixed(6)},${lng.toFixed(6)}`;
            if (this._coordsRegistry[coordKey]) {
                const count = this._coordsRegistry[coordKey]++;
                const angle = count * (Math.PI / 4); // Distribute in a circle
                const radius = 0.00002 * count; // Approx 2 meters per step
                lat += Math.cos(angle) * radius;
                lng += Math.sin(angle) * radius;
            } else {
                this._coordsRegistry[coordKey] = 1;
            }
            
            const latlng = [lat, lng];
            let color = "#0056b3"; // Blue for street
            if (type === 'candidate-prime') color = "#22c55e"; // Green for best match
            if (type === 'candidate') color = "#94a3b8"; // Grey for other candidates

            if (zoomLevel >= 18) {
                const icon = L.divIcon({
                    className: 'anncsu-civico-icon',
                    html: `<div style="background: ${color}; border: 1px solid white; border-radius: 4px; padding: 1px 4px; font-size: 9px; font-weight: bold; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.3); text-align: center; color: white; transform: translate(-50%, -50%);">${numberText}</div>`,
                    iconSize: [0, 0], // Anchor precisely on the jittered point
                    iconAnchor: [0, 0]
                });
                return L.marker(latlng, { icon: icon, title: numberText });
            } else {
                const marker = L.circleMarker(latlng, {
                    radius: type.startsWith('candidate') ? 5 : 3,
                    fillColor: color,
                    color: "#fff",
                    weight: 1,
                    opacity: 0.8,
                    fillOpacity: 0.8
                });
                marker.bindTooltip(`<strong>${numberText}</strong>`, { direction: 'top', className: 'anncsu-civico-tooltip' });
                return marker;
            }
        }

        _updateAddressMarkers() {
            const currentZoom = this.map.getZoom();
            const isTextMode = currentZoom >= 18;
            
            if (this._lastTextMode === isTextMode) return;
            this._lastTextMode = isTextMode;
            this._isZooming = true;
            this._coordsRegistry = {}; // Reset registry for new render pass

            // Update Street Addresses
            if (this.selectionLayer && this.currentStreetAddresses) {
                this.selectionLayer.clearLayers();
                this.currentStreetAddresses.forEach(addr => {
                    this._createAddressMarker(addr, currentZoom, 'street').addTo(this.selectionLayer);
                });
            }

            // Update Candidate Results
            if (this.candidateLayer && this.currentNearbyResults) {
                this.candidateLayer.clearLayers();
                this.currentNearbyResults.forEach((addr, index) => {
                    this._addCandidateToMap(addr, index, currentZoom);
                });
            }
            
            this._isZooming = false;
        }

        /**
         * Highlight the officially selected address.
         */
        showAddress(address) {
            this.selectionLayer.clearLayers();
            this.currentStreetAddresses = null; // Disable bulk zoom updates
            
            if (address && address.latitude && address.longitude) {
                const marker = L.marker([address.latitude, address.longitude]).addTo(this.selectionLayer);
                marker.bindPopup(`<strong>${address.full_number || address.number || 'Selezionato'}</strong>`).openPopup();
                this.map.setView([address.latitude, address.longitude], 18);
            }
        }

        clearMarkers() {
            if (this.selectionLayer) this.selectionLayer.clearLayers();
            if (this.candidateLayer) this.candidateLayer.clearLayers();
            this.currentStreetAddresses = null;
            this.currentNearbyResults = null;
            this._coordsRegistry = {};
        }

        /**
         * High-level sync method to automatically update the map based on client selection.
         */
        syncWithClient(config = {}) {
            const defaultOnStreet = this.options.showAllStreetPoints !== false;
            
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
