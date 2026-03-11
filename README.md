# @pallari/italian-address-map

Leaflet integration for the ANNCSU API. This package provides a visual layer to the `@pallari/italian-address-client`, allowing users to see addresses on a map, view all house numbers in a street, and select addresses by clicking on the map (reverse geocoding).

## Installation

```bash
npm install @pallari/italian-address-map leaflet
```

## Quick Start

```html
<!-- Load Leaflet -->
<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>

<!-- Load ANNCSU Clients -->
<script src="https://cdn.jsdelivr.net/npm/@pallari/italian-address-client/italian-address-client.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@pallari/italian-address-map/src/ItalianAddressMap.js"></script>

<div id="map" style="height: 400px;"></div>

<script>
    const client = new ItalianAddressClient();
    const addrMap = new ItalianAddressMap('map', client);

    // Automatically sync map with autocomplete selection
    addrMap.syncWithClient();

    // Or manual control
    // addrMap.showStreetAddresses(12345);
    // addrMap.showAddress(selectedAddressObject);
</script>
```

## Features

- **Automatic Sync**: Connects to an existing `ItalianAddressClient` instance and updates the map as the user selects municipalities or streets.
- **Street View**: When a street is selected, it can automatically display all certified house numbers as points on the map.
- **Reverse Geocoding**: Click anywhere on the map to find the nearest certified addresses (powered by high-performance PostGIS KNN search).
- **Customizable**: Full access to the underlying Leaflet instance for custom icons or layers.

## License

MIT
