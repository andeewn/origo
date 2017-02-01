/* ========================================================================
 * Copyright 2016 Origo
 * Licensed under BSD 2-Clause (https://github.com/origo-map/origo/blob/master/LICENSE.txt)
 * ======================================================================== */
"use strict";

var ol = require('openlayers');
var $ = require('jquery');
var template = require("./templates/viewer.handlebars");
var Modal = require('./modal');
var utils = require('./utils');
var isUrl = require('./utils/isurl');
var featureinfo = require('./featureinfo');
var mapwindow = require('./mapwindow');
var maputils = require('./maputils');
var style = require('./style')();

var map, mapControls, attribution, template;

var settings = {
  projection: '',
  projectionCode: '',
  projectionExtent: '',
  extent: [],
  center: [0, 0],
  zoom: 0,
  resolutions: null,
  source: {},
  group: [],
  layers: [],
  styles: {},
  controls: [],
  featureInfoOverlay: undefined,
  editLayer: null
};
var cqlQuery, queryFinished = false, urlParams;

function init(el, mapOptions) {
    $(el).html(template);
    // Read and set projection
    if (mapOptions.hasOwnProperty('proj4Defs') && proj4) {
        var proj = mapOptions['proj4Defs'];
        //Register proj4 projection definitions
        for (var i = 0; i < proj.length; i++) {
            proj4.defs(proj[i].code, proj[i].projection);
            if (proj[i].hasOwnProperty('alias')) {
                proj4.defs(proj[i].alias, proj4.defs(proj[i].code));
            }
        }
    }
    settings.params = urlParams = mapOptions.params || {};
    settings.map = mapOptions.map;
    settings.url = mapOptions.url;
    settings.baseUrl = mapOptions.baseUrl;
    if (mapOptions.hasOwnProperty('proj4Defs')) {
        // Projection to be used in map
        settings.projectionCode = mapOptions.projectionCode || undefined;
        settings.projectionExtent = mapOptions.projectionExtent;
        settings.projection = new ol.proj.Projection({
            code: settings.projectionCode,
            extent: settings.projectionExtent
        });
        settings.resolutions = mapOptions.resolutions || undefined;
        settings.tileGrid = maputils.tileGrid(settings.projectionExtent, settings.resolutions);
    }

    settings.extent = mapOptions.extent || undefined;
    settings.center = urlParams.center || mapOptions.center;
    settings.zoom = urlParams.zoom || mapOptions.zoom;
    settings.source = mapOptions.source;
    settings.groups = mapOptions.groups;
    settings.editLayer = mapOptions.editLayer;
    settings.styles = mapOptions.styles;
    style.init();
    createLayers(mapOptions.layers, settings.layers, urlParams.layers);
    settings.controls = mapOptions.controls;
    settings.consoleId = mapOptions.consoleId || 'o-console';
    settings.featureinfoOptions = mapOptions.featureinfoOptions || {};
    //If url arguments, parse this settings
    if (window.location.search) {
        parseArg();
    }

    //Create attribution
    attribution = new ol.control.Attribution({
        collapsible: false
    });

    var zoomControl = new ol.control.Zoom({
        zoomInTipLabel: ' ',
        zoomOutTipLabel: ' ',
        zoomInLabel: $.parseHTML('<svg class="o-icon-fa-plus"><use xlink:href="#fa-plus"></use></svg>')[0],
        zoomOutLabel: $.parseHTML('<svg class="o-icon-fa-minus"><use xlink:href="#fa-minus"></use></svg>')[0]
    });
    //Set map controls
    mapControls = [
        zoomControl,
        attribution,
        new ol.control.Rotate({
            label: ''
        }), /*Override default label for compass*/
        new ol.control.ScaleLine({
            target: 'o-bottom-tools'
        })
    ]
    if (window.top != window.self) {
        mapwindow.init();
    }

    loadMap();

    //Check size for attribution mode
    $(window).on('resize', checkSize);
    checkSize();

    if (urlParams.pin) {
        settings.featureinfoOptions.savedPin = urlParams.pin;
    }
    //This is needs further development for proper handling in permalink
    else if (urlParams.selection) {
        settings.featureinfoOptions.savedSelection = new ol.Feature({
            geometry: new ol.geom[urlParams.selection.geometryType](urlParams.selection.coordinates)
        });
    }
    featureinfo.init(settings.featureinfoOptions);

}
    function createLayers(layerlist, layers, savedLayers) {
        for(var i=layerlist.length-1; i>=0; i--) {
          var savedLayer = {};
          if(savedLayers) {
              savedLayer = savedLayers[layerlist[i].name.split(':').pop()] || {visible: false, legend: false};
              savedLayer.name = layerlist[i].name;
          }
          var layer = $.extend(layerlist[i],savedLayer);
          var layerOptions = setLayerOptions(layer);
            if(layer.type == 'WMTS') {
                layers.push(addWMTS(layer));
            }
            else if(layer.type == 'WMS') {
                layers.push(addWMS(layer));
            }
            else if(layer.type == 'WFS') {
                var wfsSource = wfs(layerOptions);
                layers.push(createVectorLayer(layerOptions, wfsSource));
            }
            else if(layer.type == 'AGS_FEATURE') {
                var agsFeatureSource = agsFeature(layerOptions);
                layers.push(createVectorLayer(layerOptions, agsFeatureSource));
            }
            else if(layer.type == 'AGS_TILE') {
                var agsTileSource = agsTile(layerOptions);
                layers.push(createTileLayer(layerOptions, agsTileSource));
            }
            else if(layer.type == 'GEOJSON') {
                var geojsonSource = geojson(layerOptions);
                layers.push(createVectorLayer(layerOptions, geojsonSource));
            }
            else if(layer.type == 'TOPOJSON') {
                var topojsonSource = topojson(layerOptions);
                layers.push(createVectorLayer(layerOptions, topojsonSource));
            }
            else if(layer.type == 'XYZ') {
                var xyzSource = xyz(layerOptions);
                layers.push(createTileLayer(layerOptions, xyzSource));
            }
            else if(layer.type == 'GROUP') {
                layers.push(createLayerGroup(layer.layers, layer));
            }
        }
        return layers;
    }
    function setLayerOptions(options) {
        var geometryName = options.hasOwnProperty('geometryName') ? options.geometryName : 'geom';
        var featureType = options.name.split('__').shift();
        var attr;
        options.hasOwnProperty('attribution') ? attr=[new ol.Attribution({html: options.attribution})] : [attr = null];
        var layerOptions = {
            featureType: featureType.split('__').shift(),
            name: options.name.split(':').pop(),
            id: options.id || undefined,
            title: options.title,
            group: options.group || 'none',
            opacity: options.opacity || 1,
            geometryName: geometryName,
            geometryType: options.geometryType || undefined,
            filter: options.filter || undefined,
            relations: options.relations || undefined,
            layerType: options.layerType || 'vector',
            legend: options.legend || false,
            sourceName: options.source,
            attribution: attr,
            style: options.style || 'default',
            styleName: options.style,
            tileGrid: options.tileGrid || undefined,
            queryable: options.hasOwnProperty('queryable') ? options.queryable : true,
            minResolution: options.hasOwnProperty('minScale') ? scaleToResolution(options.minScale): undefined,
            maxResolution: options.hasOwnProperty('maxScale') ? scaleToResolution(options.maxScale): undefined,
            visible: options.visible,
            type: options.type || undefined,
            extent: options.extent || undefined,
            attributes: options.attributes
        }
        if (options.hasOwnProperty('clusterStyle')) {
            layerOptions.clusterStyle = options.clusterStyle;
        }
        return layerOptions;
    }
    function createLayerGroup(layers, layersConfig) {
      var group = [];
      group = createLayers(layers, group);
      return new ol.layer.Group({
          name: layersConfig.name,
          group: layersConfig.group,
          title: layersConfig.title,
          styleName: layersConfig.style || 'default',
          layers: group,
          sourceName: layersConfig.source,
          visible: layersConfig.visible
      });
    }
    function loadMap(){

	    map = new ol.Map({
	      target: 'o-map',
	      controls: mapControls,
	      layers: settings.layers,
	      view: new ol.View({
          extent: settings.extent || undefined,
	      	projection: settings.projection || undefined,
	        center: settings.center,
          resolutions: settings.resolutions || undefined,
	        zoom: settings.zoom
	      })
	    });
    }
    function parseArg(){
    	var str = window.location.search.substring(1);
    	var elements = str.split("&");

    	for (var i = 0; i < elements.length; i++) {
          //center coordinates
         if (i==0) {
             var z = elements[i].split(",");
             settings.center[0] = parseInt(z[0]);
             settings.center[1] = parseInt(z[1]);
         }
         else if (i==1) {
             settings.zoom = parseInt(elements[i]);
         }
    		else if (i==2) {
                var l = elements[i].split(";");
                var layers = settings.layers;
                var la, match;
                for (var j = 0; j < layers.length; j++) {
                    match = 0;
                    $.each(l, function(index, el) {
                      la = el.split(",");
                      if(layers[j].get('group')) {
                        if((layers[j].get('group') == 'background') && (la[0] == layers[j].get('name'))) {
                          layers[j].setVisible(true);
                          match = 1;
                        }
                        else if ((layers[j].get('group') == 'background') && (match == 0)) {
                          layers[j].setVisible(false);
                        }
                        else if (la[0] == layers[j].get('name')) {
                          if (la[1] == 1) {
                            layers[j].set('legend', true);
                            layers[j].setVisible(false);
                          }
                          else {
                            layers[j].set('legend', true);
                            layers[j].setVisible(true);
                          }
                        }
                      }
                    })
    		        }
    	    }
        }

    }
    function getSettings() {
        return settings;
    }
    function getBaseUrl() {
        return settings.baseUrl;
    }
    function getMapName() {
        return settings.map;
    }
    function getUrl() {
        return settings.url;
    }
    function getStyleSettings() {
        return settings.styles;
    }
    function getResolutions() {
        return settings.resolutions;
    }
    function getMapUrl() {
      var layerNames = '', url;
      //delete search arguments if present
      if (window.location.search) {
          url = window.location.href.replace(window.location.search, '?');
      }
      else {
          url = window.location.href + '?';
      }
      var mapView = map.getView();
      var center = mapView.getCenter();
      for (var i=0; i < 2; i++) {
        center[i]=parseInt(center[i]); //coordinates in integers
      }
      var zoom = mapView.getZoom();
      var layers = map.getLayers();
      //add layer if visible
      layers.forEach(function(el) {
        if(el.getVisible() == true) {
            layerNames += el.get('name') + ';';
        }
        else if(el.get('legend') == true) {
            layerNames += el.get('name') + ',1;';
        }
      })
      return url + center + '&' + zoom + '&' + layerNames.slice(0, layerNames.lastIndexOf(";"));
    }
    function getMap() {
      return map;
    }
    function getLayers() {
      return settings.layers;
    }
    function getLayer(layername) {
        var layer = $.grep(settings.layers, function(obj) {
           return (obj.get('name') == layername);
        });
        return layer[0];
    }
    function getQueryableLayers() {
        var queryableLayers = settings.layers.filter(function(layer) {
            if(layer.get('queryable') && layer.getVisible()) {
                return layer;
            }
        });
        return queryableLayers;
    }
    function getGroup(group) {
        var group = $.grep(settings.layers, function(obj) {
            return (obj.get('group') == group);
        });
        return group;
    }
    function getGroups() {
        return settings.groups;
    }
    function getProjectionCode() {
      return settings.projectionCode;
    }
    function getProjection() {
      return settings.projection;
    }
    function getMapSource() {
      return settings.source;
    }
    function getControlNames() {
        var controlNames = settings.controls.map(function(obj) {
            return obj.name;
        });
        return controlNames;
    }
    function createTileLayer(options, source) {
        var tileLayer;
        options.source = source;
        tileLayer =  new ol.layer.Tile(options);
        return tileLayer;
    }
    function createVectorLayer(options, source) {
        var vectorLayer;
        switch(options.layerType) {
            case 'vector':
                options.source = source;
                options.style = style.createStyle(options.style);
                vectorLayer = new ol.layer.Vector(options);
                break;
            case 'cluster':
                options.source = new ol.source.Cluster({
                  attributions: options.attribution,
                  source: source,
                  distance: 60
                });
                options.style = style.createStyle(options.style, options.clusterStyle);
                vectorLayer = new ol.layer.Vector(options);
                break;
            case 'image':
                options.source = new ol.source.ImageVector({
                  source: source,
                  style: style.createStyle(options.style)
                });
                vectorLayer = new ol.layer.Image(options);
                break;
        }
        return vectorLayer;
    }
    function addWMS(layersConfig) {
        var version = settings.source[layersConfig.source].version || '1.1.1';
        var attr;
        layersConfig.hasOwnProperty('attribution') ? attr=[new ol.Attribution({html: layersConfig.attribution})] : [attr = null];

        return new ol.layer.Tile({
          name: layersConfig.name.split(':').pop(), //remove workspace part of name
          group: layersConfig.group || 'default',
          opacity: layersConfig.opacity || 1,
          title: layersConfig.title,
          styleName: layersConfig.style || 'default',
		      extent: layersConfig.extent || undefined,
          minResolution: layersConfig.hasOwnProperty('minScale') ? scaleToResolution(layersConfig.minScale): undefined,
          maxResolution: layersConfig.hasOwnProperty('maxScale') ? scaleToResolution(layersConfig.maxScale): undefined,
          type: layersConfig.type,
          visible: layersConfig.visible,
          attributes: layersConfig.attributes,
          queryable: true || layersConfig.queryable,
          featureinfoLayer: layersConfig.featureinfoLayer || undefined,
          legend: false,
          sourceName: layersConfig.source,
          source: new ol.source.TileWMS(({
            attributions: attr,
            url: settings.source[layersConfig.source].url,
            gutter: layersConfig.gutter || 0,
            crossOrigin: 'anonymous',
            projection: settings.projection,
            params: {'LAYERS': layersConfig.name, 'TILED': true, VERSION: version}
          }))
        })
    }
    function addWMTS(layersConfig) {
        var matrixIds = [], attr = null;
        var layerSource = settings.source[layersConfig.source];
        var matrixSet = layerSource.hasOwnProperty('matrixSetName') ? layerSource.matrixSetName : settings.projectionCode;
        var matrixIdsPrefix = layerSource.hasOwnProperty('matrixIdsPrefix') ? layerSource.matrixIdsPrefix : settings.projectionCode + ':';
        for (var z = 0; z < settings.resolutions.length; ++z) {
          matrixIds[z] = matrixIdsPrefix + z;
        }

        layersConfig.hasOwnProperty('attribution') ? attr=[new ol.Attribution({html: layersConfig.attribution})] : [attr = null];

        return new ol.layer.Tile({
           group: layersConfig.group || 'background',
           name: layersConfig.name.split(':').pop(), //remove workspace part of name
           opacity: layersConfig.opacity || 1,
           title: layersConfig.title,
           styleName: layersConfig.style || 'default',
           minResolution: layersConfig.hasOwnProperty('minScale') ? scaleToResolution(layersConfig.minScale): undefined,
           maxResolution: layersConfig.hasOwnProperty('maxScale') ? scaleToResolution(layersConfig.maxScale): undefined,
           visible: layersConfig.visible,
           type: layersConfig.type,
           queryable: layersConfig.queryable || false,
           featureinfoLayer: layersConfig.featureinfoLayer || undefined,
           extent: layersConfig.extent || settings.extent, //layer extent to avoid bad requests out of range
           sourceName: layersConfig.name,
           source: new ol.source.WMTS({
             crossOrigin: 'anonymous',
             attributions: attr,
             url: layerSource.url,
             projection: settings.projection,
             layer: layersConfig.name,
             matrixSet: matrixSet,
             format: layersConfig.format,
             tileGrid: new ol.tilegrid.WMTS({
               origin: ol.extent.getTopLeft(settings.projectionExtent),
               resolutions: settings.resolutions,
               matrixIds: matrixIds
             }),
             style: 'default'
           })
        })
    }
    function geojson(options) {
        var url;
        if (isUrl(options.sourceName)) {
          url = options.sourceName;
        } else {
          url = settings.baseUrl + options.sourceName;
        }
        return new ol.source.Vector({
            attributions: options.attribution,
            url: url,
            format: new ol.format.GeoJSON()
        })
    }
    function topojson(options) {
        return new ol.source.Vector({
            attributions: options.attribution,
            url: options.sourceName,
            format: new ol.format.TopoJSON({defaultDataProjection: settings.projection})
        })
    }
    function wfs(options) {
        var vectorSource = null;
        var serverUrl = settings.source[options.sourceName].url;

        //If cql filter then bbox must be used in the filter.
        var geometryName = options.geometryName;
        var queryFilter = options.filter ? '&CQL_FILTER=' + options.filter + ' AND BBOX(' + geometryName + ',' : '&BBOX=';
        var bboxProjectionCode = options.filter ? "'" + settings.projectionCode + "')" : settings.projectionCode;
        vectorSource = new ol.source.Vector({
          attributions: options.attribution,
          format: new ol.format.GeoJSON({geometryName: options.geometryName}),
          loader: function(extent, resolution, projection) {
              var url = serverUrl +
                  '?service=WFS&' +
                  'version=1.1.0&request=GetFeature&typeName=' + options.featureType +
                  '&outputFormat=application/json' +
                  '&srsname=' + settings.projectionCode +
                  queryFilter + extent.join(',') + ',' + bboxProjectionCode;
              $.ajax({
                url: url,
                cache: false
              })
              .done(function(response) {
                  vectorSource.addFeatures(vectorSource.getFormat().readFeatures(response));
              });
          },
          strategy: ol.loadingstrategy.tile(ol.tilegrid.createXYZ({
              maxZoom: settings.resolutions.length
          }))
        });
        return vectorSource;
    }
    function agsFeature(options) {
        var vectorSource = null;
        var esriSrs = settings.projectionCode.split(':').pop();
        var serverUrl = settings.source[options.sourceName].url;
        var queryFilter = options.filter ? '&where=' + options.filter : '';
        var esrijsonFormat = new ol.format.EsriJSON();
        vectorSource = new ol.source.Vector({
            attributions: options.attribution,
            loader: function(extent, resolution, projection) {
              var that = this;
              // var serverUrl = settings.source[options.source].url;
              var url = serverUrl + options.id +
                  encodeURI('/query?f=json&' +
                  'returnGeometry=true' +
                  '&spatialRel=esriSpatialRelIntersects' +
                  '&geometry=' + '{"xmin":' + extent[0] + ',"ymin":' +
                      extent[1] + ',"xmax":' + extent[2] + ',"ymax":' + extent[3] +
                      ',"spatialReference":{"wkid":' + esriSrs + '}}' +
                  '&geometryType=esriGeometryEnvelope'+
                  '&inSR=' + esriSrs + '&outFields=*' + '' + '&returnIdsOnly=false&returnCountOnly=false' +
                  '&geometryPrecision=2' +
                  '&outSR=' + esriSrs + queryFilter);
              // use jsonp: false to prevent jQuery from adding the "callback"
              // parameter to the URL
              $.ajax({
                url: url,
                dataType: 'jsonp',
                success: function(response) {
                    if (response.error) {
                        alert(response.error.message + '\n' +
                            response.error.details.join('\n'));
                    }
                    else {
                        // dataProjection will be read from document
                        var features = esrijsonFormat.readFeatures(response, {
                            featureProjection: projection
                        });
                        if (features.length > 0) {
                            that.addFeatures(features);
                        }
                    }
                }
              });
            },
            strategy: ol.loadingstrategy.bbox
        });
        return vectorSource;
    }
    function agsTile(options) {
        var url = settings.source[options.sourceName].url;
        var params = options.params || {};
        params.layers = "show:" + options.id;
        var tileSource = new ol.source.TileArcGISRest({
            attributions: options.attribution,
            projection: settings.projection,
            crossOrigin: 'anonymous',
            params: params,
            url: url
        });
        return tileSource;
    }
    function xyz(options) {
        var format = options.sourceName.split('.')[1],
        url = options.sourceName.split('.')[0] + '/{z}/{x}/{y}.';
        url += format;
        var tileSource = new ol.source.XYZ({
            attributions: options.attribution,
            projection: settings.projection || 'EPSG:3857',
            tileGrid: settings.tileGrid || undefined,
            url: url
        });
        return tileSource;
    }

    function checkScale(scale, maxScale, minScale) {
        if (maxScale || minScale) {
          // Alter 1: maxscale and minscale
          if(maxScale && minScale) {
            if ((scale > maxScale) && (scale < minScale)) {
              return true;
            }
          }
          // Alter 2: only maxscale
          else if (maxScale) {
            if(scale > maxScale) {
              return true;
            }
          }
          // Alter 3: only minscale
          else if (minScale) {
            if(scale < minScale) {
              return true;
            }
          }
        }
        // Alter 4: no scale limit
        else {
            return true;
        }
    }
    function getConsoleId() {
      return settings.consoleId;
    }
    function getScale(resolution) {
      var dpi = 25.4 / 0.28;
      var mpu = settings.projection.getMetersPerUnit();
      var scale = resolution * mpu * 39.37 * dpi;
      scale = Math.round(scale);
      return scale;
    }
    function scaleToResolution(scale) {
      var dpi = 25.4 / 0.28;
      var mpu = settings.projection.getMetersPerUnit();
      var resolution = scale / (mpu * 39.37 * dpi);
      return resolution;
    }
    function autoPan() {
    /*Workaround to remove when autopan implemented for overlays */
      var el=$('.o-popup');
      var center = map.getView().getCenter();
      var popupOffset = $(el).offset();
      var mapOffset = $('#' + map.getTarget()).offset();
      var offsetY = popupOffset.top - mapOffset.top;
      var mapSize = map.getSize();
      var offsetX = (mapOffset.left + mapSize[0])-(popupOffset.left+$(el).outerWidth(true));
      // Check if mapmenu widget is used and opened
      var menuSize = 0;
      if(settings.controls.hasOwnProperty('mapmenu')) {
        menuSize = settings.controls.mapmenu.getTarget().offset().left > 0 ? mapSize[0]- settings.controls.mapmenu.getTarget().offset().left : menuSize = 0;
      }
      if (offsetY < 0 || offsetX < 0 + menuSize || offsetX > (mapSize[0]-$(el).outerWidth(true))) {
        var dx = 0, dy = 0;
        if (offsetX < 0 + menuSize) {
          dx = (-offsetX + menuSize)*map.getView().getResolution();
        }
        if (offsetX > (mapSize[0]-$(el).outerWidth(true))) {
          dx = -($(el).outerWidth(true)-(mapSize[0]-offsetX))*map.getView().getResolution();
        }
        if (offsetY < 0) {
          dy = (-offsetY)*map.getView().getResolution();
        }
        var pan = ol.animation.pan({
          duration: 300,
          source: center
        });
        map.beforeRender(pan);
        map.getView().setCenter([center[0]+dx, center[1]+dy]);

      }
    /*End workaround*/
    }
    function removeOverlays(overlays) {
      if (overlays) {
        if (overlays.constructor === Array || overlays instanceof ol.Collection) {
          overlays.forEach(function(overlay) {
            map.removeOverlay(overlay);
          })
        } else {
            map.removeOverlay(overlays);
        }
      } else {
        map.getOverlays().clear();
      }
    }
    function checkSize() {
        var small = map.getSize()[0] < 768;
        attribution.setCollapsible(small);
        attribution.setCollapsed(small);
    }

module.exports.init = init;
module.exports.createLayers = createLayers;
module.exports.createLayerGroup = createLayerGroup;
module.exports.loadMap = loadMap;
module.exports.parseArg = parseArg;
module.exports.getBaseUrl = getBaseUrl;
module.exports.getSettings = getSettings;
module.exports.getStyleSettings = getStyleSettings;
module.exports.getMapUrl = getMapUrl;
module.exports.getMap = getMap;
module.exports.getLayers = getLayers;
module.exports.getLayer = getLayer;
module.exports.getControlNames = getControlNames;
module.exports.getQueryableLayers = getQueryableLayers;
module.exports.getGroup = getGroup;
module.exports.getGroups = getGroups;
module.exports.getProjectionCode = getProjectionCode;
module.exports.getProjection = getProjection;
module.exports.getMapSource = getMapSource;
module.exports.getResolutions = getResolutions;
module.exports.addWMS = addWMS;
module.exports.addWMTS = addWMTS;
module.exports.geojson = geojson;
module.exports.topojson = topojson;
module.exports.wfs = wfs;
module.exports.getScale = getScale;
module.exports.scaleToResolution = scaleToResolution;
module.exports.autoPan = autoPan;
module.exports.removeOverlays = removeOverlays;
module.exports.checkScale= checkScale;
module.exports.checkSize = checkSize;
module.exports.getMapName = getMapName;
module.exports.getConsoleId = getConsoleId;
module.exports.getUrl = getUrl;
