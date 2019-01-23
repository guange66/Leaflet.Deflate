'use strict';

L.Deflate = L.FeatureGroup.extend({
  options: {
    minSize: 10,
    markerCluster: false,
    markerOptions: {},
    markerClusterOptions: {},
  },

  initialize: function (options) {
    L.Util.setOptions(this, options);
    this._layers = [];
    this._needsPrepping = [];
    this._featureLayer = (options.markerCluster
      ? L.markerClusterGroup(this.options.markerClusterOptions)
      : L.featureGroup(options));
  },

  _getBounds: function (path) {
    // L.Circle defines the radius in metres. If you want to calculate
    // the bounding box of a circle, it needs to be projected on the map.
    // The only way to do that at present is to add it to the map. We're
    // removing the circle after computing the bounds because we haven't
    // figured out wether to display the circle or the deflated marker.
    // It's a terribly ugly solution but ¯\_(ツ)_/¯
    var bounds;

    if (path instanceof L.Circle) {
      path.addTo(this._map);
      bounds = path.getBounds();
      this._map.removeLayer(path);
      return bounds;
    }
    return path.getBounds();
  },

  _isCollapsed: function (path, zoom) {
    var bounds = path.computedBounds;

    var northEastPixels = this._map.project(bounds.getNorthEast(), zoom);
    var southWestPixels = this._map.project(bounds.getSouthWest(), zoom);

    var width = northEastPixels.x - southWestPixels.x;
    var height = southWestPixels.y - northEastPixels.y;
    return (height < this.options.minSize || width < this.options.minSize);
  },

  _getZoomThreshold: function (path) {
    var zoomThreshold = null;
    var zoom = this._map.getZoom();
    if (this._isCollapsed(path, this._map.getZoom())) {
      while (!zoomThreshold) {
        zoom += 1;
        if (!this._isCollapsed(path, zoom)) {
          zoomThreshold = zoom - 1;
        }
      }
    } else {
      while (!zoomThreshold) {
        zoom -= 1;
        if (this._isCollapsed(path, zoom)) {
          zoomThreshold = zoom;
        }
      }
    }
    return zoomThreshold;
  },

  _bindInfoTools: function (marker, parentLayer) {
    if (parentLayer._popupHandlersAdded) {
      marker.bindPopup(parentLayer._popup._content, parentLayer._popup.options);
    }

    if (parentLayer._tooltipHandlersAdded) {
      marker.bindTooltip(parentLayer._tooltip._content, parentLayer._tooltip.options);
    }
  },

  _bindEvents: function _bindEvents(marker, parentLayer) {
    var i = 0;
    var j = 0;
    var lenI = 0;
    var lenJ = 0;
    var events = parentLayer._events;
    var eventKeys = events ? Object.getOwnPropertyNames(events) : [];
    var eventParents = parentLayer._eventParents;
    var eventParentKeys = eventParents ? Object.getOwnPropertyNames(eventParents) : [];
    var listeners;

    this._bindInfoTools(marker, parentLayer);

    for (i = 0, lenI = eventKeys.length; i < lenI; i += 1) {
      listeners = events[eventKeys[i]];
      for (j = 0, lenJ = listeners.length; j < lenJ; j += 1) {
        marker.on(eventKeys[i], listeners[j].fn);
      }
    }

    // For FeatureGroups we need to bind all events, tooltips and popups
    // from the FeatureGroup to each marker
    if (!parentLayer._eventParents) { return; }

    for (i = 0, lenI = eventParentKeys.length; i < lenI; i += 1) {
      if (!parentLayer._eventParents[eventParentKeys[i]]._map) {
        this._bindEvents(marker, parentLayer._eventParents[eventParentKeys[i]]);

        // We're copying all layers of a FeatureGroup, so we need to bind
        // all tooltips and popups to the original feature.
        this._bindInfoTools(parentLayer, parentLayer._eventParents[eventParentKeys[i]]);
      }
    }
  },

  _makeMarker: function (layer) {
    var markerOptions = typeof this.options.markerOptions === 'function'
      ? this.options.markerOptions(layer)
      : this.options.markerOptions;
    var marker = L.marker(layer.computedBounds.getCenter(), markerOptions);
    var markerFeature = layer.feature ? marker.toGeoJSON() : undefined;

    this._bindEvents(marker, layer);

    if (markerFeature) {
      markerFeature.properties = layer.feature.properties;
      marker.feature = markerFeature;
    }

    return marker;
  },

  prepLayer: function (layer) {
    var zoomThreshold;

    if (layer.getBounds) {
      layer.computedBounds = this._getBounds(layer);

      zoomThreshold = this._getZoomThreshold(layer);

      layer.zoomThreshold = zoomThreshold;
      layer.marker = this._makeMarker(layer);
      layer.zoomState = this._map.getZoom();
    }
  },

  _addToMap: function (layer) {
    var layerToAdd = this._map.getZoom() <= layer.zoomThreshold ? layer.marker : layer;
    this._featureLayer.addLayer(layerToAdd);
  },

  addLayer: function (layer) {
    var layers = layer instanceof L.FeatureGroup ? Object.getOwnPropertyNames(layer._layers) : [];
    var i = 0;
    var len = layers.length;
    if (layers.length) {
      for (i = 0, len = layers.length; i < len; i += 1) {
        this.addLayer(layer._layers[layers[i]]);
      }
    } else {
      if (this._map) {
        this.prepLayer(layer);
        this._addToMap(layer);
      } else {
        this._needsPrepping.push(layer);
      }
      this._layers[this.getLayerId(layer)] = layer;
    }
  },

  removeLayer: function (layer) {
    var layerId;
    var layerIndex;
    var layers = layer instanceof L.FeatureGroup ? Object.getOwnPropertyNames(layer._layers) : [];
    var i = 0;
    var len = layers.length;

    if (layers.length) {
      for (i = 0, len = layers.length; i < len; i += 1) {
        this.removeLayer(layer._layers[layers[i]]);
      }
    } else {
      layerId = layer in this._layers ? layer : this.getLayerId(layer);

      this._featureLayer.removeLayer(this._layers[layerId]);
      if (this._layers[layerId].marker) {
        this._featureLayer.removeLayer(this._layers[layerId].marker);
      }

      delete this._layers[layerId];

      layerIndex = this._needsPrepping.indexOf(this._layers[layerId]);
      if (layerIndex !== -1) { this._needsPrepping.splice(layerIndex, 1); }
    }
  },

  clearLayers: function () {
    this._featureLayer.clearLayers();
    this._layers = [];
  },

  _switchDisplay: function (layer, showMarker) {
    if (showMarker) {
      this._featureLayer.addLayer(layer.marker);
      this._featureLayer.removeLayer(layer);
    } else {
      this._featureLayer.addLayer(layer);
      this._featureLayer.removeLayer(layer.marker);
    }
  },

  _deflate: function () {
    var bounds = this._map.getBounds();
    var endZoom = this._map.getZoom();

    this.eachLayer(function (layer) {
      if (layer.marker && layer.zoomState !== endZoom && layer.computedBounds.intersects(bounds)) {
        this._switchDisplay(layer, endZoom <= layer.zoomThreshold);
        layer.zoomState = endZoom;
      }
    }, this);
  },

  onAdd: function (map) {
    var i = 0;
    var len = this._needsPrepping.length;
    this._featureLayer.addTo(map);
    this._map.on('zoomend', this._deflate, this);
    this._map.on('moveend', this._deflate, this);

    for (; i < len; i += 1) {
      this.addLayer(this._needsPrepping[i]);
    }
    this._needsPrepping = [];
    this._deflate();
  },

  onRemove: function (map) {
    map.removeLayer(this._featureLayer);
    this._map.off('zoomend', this._deflate, this);
    this._map.off('moveend', this._deflate, this);
  },
});

L.deflate = function (options) {
  return new L.Deflate(options);
};
