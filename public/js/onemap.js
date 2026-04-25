// =================== ONEMAP.MV API IMPLEMENTATION WITH FLOOD BUBBLES ===================

// Store references for flood bubbles
let floodGraphicsLayer = null;
let currentFloodGraphics = [];

// "Both ready" coordinator , fires bubbles only when map AND data are both loaded
window._mapReady = false;
window._tryFloodBubbles = function() {
    if (!window._mapReady) return;
    if (!window.state || !window.state.allScenarios || !window.state.scenario) return;
    if (!window.floodGraphicsLayer || !window.GraphicClass || !window.PointClass) return;
    updateFloodBubbles(window.state.allScenarios[window.state.scenario]);
};

// Load ArcGIS JavaScript API
function loadArcGISScripts() {
    return new Promise((resolve, reject) => {
        if (window.require) {
            resolve();
            return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://js.arcgis.com/4.29/esri/themes/light/main.css';
        document.head.appendChild(link);

        const script = document.createElement('script');
        script.src = 'https://js.arcgis.com/4.29/';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Convert WGS84 to Web Mercator for flood bubbles
function wgs84ToWebMercator(lon, lat) {
    const x = lon * 20037508.34 / 180;
    let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
    y = y * 20037508.34 / 180;
    return [x, y];
}

// Get flood color based on percentage
function getFloodColor(pct) {
    if (pct >= 75) return [255, 61, 90, 0.85];
    if (pct >= 50) return [251, 113, 133, 0.85];
    if (pct >= 25) return [251, 191, 36, 0.85];
    return [52, 211, 153, 0.85];
}

// Update flood bubbles on map
async function updateFloodBubbles(scenarioData) {
    if (!floodGraphicsLayer || !window.GraphicClass || !window.PointClass) {
        console.log('Flood graphics layer not ready');
        return;
    }

    floodGraphicsLayer.removeAll();
    currentFloodGraphics = [];

    if (!scenarioData || !Array.isArray(scenarioData)) {
        console.log('No scenario data available');
        return;
    }

    // Apply inhabited-only filter if toggled on
    const inhabitedOnly = window.state && window.state.mapInhabitedOnly;
    const data = inhabitedOnly ? scenarioData.filter(i => i.population > 0) : scenarioData;
    console.log(`Adding ${data.length} flood bubbles (${inhabitedOnly ? 'inhabited only' : 'all islands'})`);

    data.forEach(island => {
        if (!island.lon || !island.lat) return;
        
        const [x, y] = wgs84ToWebMercator(island.lon, island.lat);
        const radius = Math.max(8, Math.min(40, Math.sqrt(island.area_km2) * 10));
        const fillColor = getFloodColor(island.pct_inundated);
        
        const point = new window.PointClass({
            x: x,
            y: y,
            spatialReference: { wkid: 3857 }
        });
        
        // Determine risk level text
        let riskLevel = '';
        if (island.pct_inundated >= 75) riskLevel = '[HIGH] Extreme Risk';
        else if (island.pct_inundated >= 50) riskLevel = '[MED-HIGH] High Risk';
        else if (island.pct_inundated >= 25) riskLevel = '[MED] Medium Risk';
        else riskLevel = '[LOW] Low Risk';
        
        const popupContent = `
            <div style="padding: 12px; font-family: 'Inter', sans-serif; min-width: 240px;">
                <div style="font-weight: 700; font-size: 15px; color: #2dd4bf; margin-bottom: 8px; border-bottom: 1px solid #2dd4bf33; padding-bottom: 6px;">
                     ${island.island_name}
                </div>
                <div style="margin-bottom: 8px;">
                    <span style="display: inline-block; background: rgba(45,212,191,0.12); padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; color: #2dd4bf;">
                        ${riskLevel}
                    </span>
                </div>
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">
                    <span style="color: #5b6e8c;"> Atoll:</span> <strong style="color: #e2e8f0">${island.atoll}</strong>
                </div>
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">
                    <span style="color: #5b6e8c;"> Area:</span> <strong style="color: #e2e8f0">${island.area_km2} km^2</strong>
                </div>
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">
                    <span style="color: #5b6e8c;"> Inundated:</span> <strong style="color: ${island.pct_inundated >= 75 ? '#ff3d5a' : island.pct_inundated >= 50 ? '#fb7185' : island.pct_inundated >= 25 ? '#fbbf24' : '#34d399'}">${island.pct_inundated}%</strong>
                </div>
                ${island.population > 0
                    ? `<div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;"><span style="color: #5b6e8c;">Population: Population:</span> <strong style="color: #e2e8f0">${island.population.toLocaleString()}</strong></div><div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;"><span style="color: #5b6e8c;">! Pop. at Risk:</span> <strong style="color: #e2e8f0">${island.pop_at_risk.toLocaleString()}</strong></div>`
                    : '<div style="font-size: 11px; color: #5b6e8c; margin-bottom: 6px;">Uninhabited / Resort</div>'
                }
                <div style="font-size: 11px; color: #5b6e8c; margin-top: 8px; padding-top: 6px; border-top: 1px solid #2dd4bf1a;">
                     Vulnerability Index: <strong style="color: #2dd4bf">${island.vulnerability_index}</strong>
                </div>
            </div>
        `;
        
        const graphic = new window.GraphicClass({
            geometry: point,
            symbol: {
                type: "simple-marker",
                style: "circle",
                color: fillColor,
                size: radius * 2,
                outline: { color: [255, 255, 255, 0.4], width: 2 }
            },
            attributes: {
                name: island.island_name,
                pct: island.pct_inundated,
                population: island.population,
                area: island.area_km2,
                atoll: island.atoll,
                pop_at_risk: island.pop_at_risk,
                vulnerability_index: island.vulnerability_index
            },
            popupTemplate: {
                title: "{name}",
                content: popupContent
            }
        });
        
        floodGraphicsLayer.add(graphic);
        currentFloodGraphics.push(graphic);
    });
    
    console.log(`[OK] Added ${currentFloodGraphics.length} flood bubbles to map`);
}

// Initialize Interactive Map
async function initializeInteractiveMap() {
    const mapContainer = document.querySelector('.map-container');
    
    if (!mapContainer) {
        console.error('Map container not found');
        return;
    }

    try {
        await loadArcGISScripts();
        createOneMapWithFloodBubbles(mapContainer);
    } catch (error) {
        console.error('Error initializing interactive map:', error);
        showFallbackMap();
    }
}

// Create onemap.mv with flood bubbles
function createOneMapWithFloodBubbles(container) {
    require([
        "esri/Map",
        "esri/views/MapView",
        "esri/layers/FeatureLayer",
        "esri/layers/GraphicsLayer",
        "esri/Graphic",
        "esri/symbols/SimpleFillSymbol",
        "esri/symbols/SimpleLineSymbol",
        "esri/Color",
        "esri/widgets/Zoom",
        "esri/widgets/Home",
        "esri/widgets/Locate",
        "esri/widgets/Popup",
        "esri/symbols/TextSymbol",
        "esri/geometry/SpatialReference",
        "esri/geometry/Point",
        "esri/layers/TileLayer"
    ], (Map, MapView, FeatureLayer, GraphicsLayer, Graphic, SimpleFillSymbol, SimpleLineSymbol, Color, Zoom, Home, Locate, Popup, TextSymbol, SpatialReference, Point, TileLayer) => {
        
        // Store classes globally for flood bubbles
        window.GraphicClass = Graphic;
        window.PointClass = Point;
        
        // Clear container and add map div
        container.innerHTML = '<div id="arcgis-map" style="width:100%;height:100%;"></div>';
        
        // Create flood graphics layer
        floodGraphicsLayer = new GraphicsLayer({
            title: "Flood Risk Bubbles",
            id: "floodBubbles"
        });
        
        // Create graphics layer for labels and highlights
        const labelsLayer = new GraphicsLayer();
        const highlightLayer = new GraphicsLayer();
        
        // Store island labels for reference
        let islandLabels = [];
        
        // Create the map with flood bubbles layer
        const map = new Map({
            basemap: {
                baseLayers: [
                    new TileLayer({
                        url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
                        opacity: 1.0,  // Changed from 0.00 to 1.00 to show basemap
                        title: "World Imagery"
                    })
                ]
            },
            layers: [labelsLayer, highlightLayer, floodGraphicsLayer]
        });

        // Create the map view
        const view = new MapView({
            container: "arcgis-map",
            map: map,
            center: [73.5089, 4.1753],
            zoom: 8.5,  // Changed from 15 to show all islands
            spatialReference: SpatialReference.WebMercator,
            constraints: {
                minZoom: 7,
                maxZoom: 18,
                rotationEnabled: false
            },
            ui: {
                components: []
            },
            popup: new Popup({
                dockEnabled: false,
                dockOptions: {
                    buttonEnabled: false,
                    breakpoint: false
                }
            }),
        });

        // =================== ONEMAP.MV LAYERS ===================
        
        // 1. Reef Layer
        const reefLayer = new FeatureLayer({
            url: "https://services7.arcgis.com/yvCbn3q8PPtPLZIM/arcgis/rest/services/reef/FeatureServer/0",
            title: "Reefs",
            opacity: 0.35,
            outFields: ["*"],
            popupTemplate: {
                title: "{FCODE} - {name}",
                content: createExactReefPopup
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [225, 245, 225, 0.4],
                    outline: {
                        color: [180, 220, 180, 0.6],
                        width: 0.4
                    }
                }
            }
        });

        // 2. Lagoon Layer
        const lagoonLayer = new FeatureLayer({
            url: "https://services7.arcgis.com/yvCbn3q8PPtPLZIM/arcgis/rest/services/lagoon/FeatureServer/0",
            title: "Lagoons",
            opacity: 0.25,
            outFields: ["*"],
            popupTemplate: {
                title: "{name}",
                content: createExactLagoonPopup
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [225, 240, 255, 0.3],
                    outline: {
                        color: [190, 215, 235, 0.5],
                        width: 0.4
                    }
                }
            }
        });

        // 3. Island Layer
        const islandLayer = new FeatureLayer({
            url: "https://services7.arcgis.com/yvCbn3q8PPtPLZIM/arcgis/rest/services/island_20240509/FeatureServer/0",
            title: "Islands",
            opacity: 0.95,
            outFields: ["*"],
            popupTemplate: {
                title: "{islandName}",
                content: createExactIslandPopup
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [240, 230, 210, 0.95],
                    outline: {
                        color: [195, 170, 135, 1],
                        width: 0.6
                    }
                }
            }
        });

        // Add all layers in order
        map.add(reefLayer);
        map.add(lagoonLayer);
        map.add(islandLayer);

        // Current highlight reference
        let currentHighlight = null;
        let currentLabelHighlight = null;
        
        // Smart function to add island labels based on zoom level
        async function addSmartIslandLabels() {
            try {
                const currentZoom = view.zoom;
                labelsLayer.removeAll();
                islandLabels = [];
                
                let queryWhere = "1=1";
                if (currentZoom <= 7) {
                    queryWhere = "capital = 'Y'";
                } else if (currentZoom <= 10) {
                    queryWhere = "capital = 'Y'";
                } else {
                    queryWhere = "Area_ha > 20 OR capital = 'Y'";
                }
                
                const query = islandLayer.createQuery();
                query.where = queryWhere;
                query.outFields = ["islandName", "latitude", "longitude", "OBJECTID", "capital", "Area_ha"];
                query.returnGeometry = true;
                query.maxRecordCount = 2000;
                
                const results = await islandLayer.queryFeatures(query);
                
                let fontSize = "9px";
                if (currentZoom <= 7) fontSize = "10px";
                if (currentZoom >= 12) fontSize = "8px";
                
                results.features.forEach(feature => {
                    const islandName = feature.attributes.islandName;
                    const geometry = feature.geometry;
                    const isCapital = feature.attributes.capital === 'Y';
                    
                    if (islandName && islandName.trim() !== "") {
                        const fontWeight = isCapital ? "bold" : "normal";
                        const textColor = [0, 0, 0, 1];
                        
                        const textSymbol = new TextSymbol({
                            text: islandName,
                            font: {
                                family: "Arial",
                                size: fontSize,
                                weight: fontWeight
                            },
                            color: new Color(textColor),
                            haloColor: new Color([255, 255, 255, 0.7]),
                            haloSize: "1px",
                            xoffset: 0,
                            yoffset: 0
                        });
                        
                        const labelGraphic = new Graphic({
                            geometry: geometry,
                            symbol: textSymbol,
                            attributes: feature.attributes
                        });
                        
                        labelsLayer.add(labelGraphic);
                        islandLabels.push(labelGraphic);
                    }
                });
            } catch (error) {
                console.error('Error adding island labels:', error);
            }
        }

        function createExactHighlight(geometry, attributes, layerType) {
            let color, outlineColor;
            switch(layerType) {
                case 'reef':
                    color = [180, 220, 180, 0.2];
                    outlineColor = [140, 200, 140, 0.4];
                    break;
                case 'lagoon':
                    color = [190, 215, 235, 0.2];
                    outlineColor = [150, 190, 220, 0.4];
                    break;
                case 'island':
                default:
                    color = [218, 190, 140, 0.25];
                    outlineColor = [195, 170, 135, 0.5];
            }
            
            return new Graphic({
                geometry: geometry,
                symbol: new SimpleFillSymbol({
                    color: new Color(color),
                    outline: new SimpleLineSymbol({
                        color: new Color(outlineColor),
                        width: 1
                    })
                }),
                attributes: attributes
            });
        }

        function highlightLabel(islandName, geometry) {
            if (currentLabelHighlight) {
                labelsLayer.remove(currentLabelHighlight);
            }
            
            const highlightSymbol = new TextSymbol({
                text: islandName,
                font: {
                    family: "Arial",
                    size: "10px",
                    weight: "bold"
                },
                color: new Color([0, 80, 160, 1]),
                haloColor: new Color([255, 255, 255, 0.9]),
                haloSize: "2px"
            });
            
            currentLabelHighlight = new Graphic({
                geometry: geometry,
                symbol: highlightSymbol
            });
            
            labelsLayer.add(currentLabelHighlight);
        }

        // Reef popup
        function createExactReefPopup(feature) {
            const attributes = feature.graphic.attributes;
            const name = attributes.name || attributes.Name || "Unnamed Reef";
            const fcode = attributes.FCODE || "N/A";
            const atoll = attributes.atoll || attributes.Atoll || "Unknown Atoll";
            const areaHa = attributes.Areaha ? parseFloat(attributes.Areaha).toFixed(0) : "N/A";
            
            return `
                <div class="exact-onemap-popup" style="padding: 10px; font-family: 'Segoe UI', sans-serif; max-width: 300px; font-size: 13px;">
                    <div style="display: flex; align-items: center; margin-bottom: 6px;">
                        <div style="width: 2px; height: 18px; background-color: #A8D5A8; margin-right: 6px;"></div>
                        <h3 style="color: #2D6A2D; margin: 0; font-size: 14px; font-weight: 500;">
                            ${fcode} - ${name}
                        </h3>
                    </div>
                    <div style="background: #F0F8F0; border-radius: 4px; padding: 10px; margin-bottom: 6px;">
                        <div style="color: #666; margin-bottom: 4px; font-size: 12px;">Atoll: <span style="color: #333; font-weight: 500;">${atoll}</span></div>
                        <div style="color: #666; font-size: 12px;">Area: <span style="color: #333; font-weight: 500;">${areaHa} ha</span></div>
                    </div>
                    <div style="font-size: 10px; color: #999; text-align: center; padding-top: 6px; border-top: 1px solid #E5E5E5;">
                        Geomatics Department | onemap.mv
                    </div>
                </div>
            `;
        }

        // Lagoon popup
        function createExactLagoonPopup(feature) {
            const attributes = feature.graphic.attributes;
            const name = attributes.name || attributes.Name || "Unnamed Lagoon";
            const fcode = attributes.FCODE || "N/A";
            const atoll = attributes.atoll || attributes.Atoll || "Unknown Atoll";
            const areaHa = attributes.Area_Ha ? parseFloat(attributes.Area_Ha).toFixed(2) : "N/A";
            
            return `
                <div class="exact-onemap-popup" style="padding: 10px; font-family: 'Segoe UI', sans-serif; max-width: 300px; font-size: 13px;">
                    <div style="display: flex; align-items: center; margin-bottom: 6px;">
                        <div style="width: 2px; height: 18px; background-color: #A8C6E0; margin-right: 6px;"></div>
                        <h3 style="color: #2D5A8C; margin: 0; font-size: 14px; font-weight: 500;">
                            ${fcode} - ${name}
                        </h3>
                    </div>
                    <div style="background: #F0F5FA; border-radius: 4px; padding: 10px; margin-bottom: 6px;">
                        <div style="color: #666; margin-bottom: 4px; font-size: 12px;">Atoll: <span style="color: #333; font-weight: 500;">${atoll}</span></div>
                        <div style="color: #666; font-size: 12px;">Area: <span style="color: #333; font-weight: 500;">${areaHa} ha</span></div>
                    </div>
                    <div style="font-size: 10px; color: #999; text-align: center; padding-top: 6px; border-top: 1px solid #E5E5E5;">
                        Geomatics Department | onemap.mv
                    </div>
                </div>
            `;
        }

        // Island popup
        function createExactIslandPopup(feature) {
            const attributes = feature.graphic.attributes;
            const islandName = attributes.islandName || attributes.IslandName || "Unknown Island";
            const atollName = attributes.atoll || attributes.Atoll || "Unknown Atoll";
            const islandCode = attributes.FCODE || "N/A";
            const category = attributes.category || attributes.Category || "Not specified";
            const capital = attributes.capital === "Y" ? "Yes" : "No";
            const areaHa = attributes.Area_ha ? parseFloat(attributes.Area_ha).toFixed(2) : "N/A";
            const islandNameDhivehi = attributes.islandNa_1 || "N/A";
            
            return `
                <div class="exact-onemap-popup" style="padding: 10px; font-family: 'Segoe UI', sans-serif; max-width: 300px; font-size: 13px;">
                    <div style="display: flex; align-items: center; margin-bottom: 6px;">
                        <div style="width: 2px; height: 18px; background-color: #E0C8A0; margin-right: 6px;"></div>
                        <h3 style="color: #8C6D2D; margin: 0; font-size: 14px; font-weight: 500;">
                            ${islandName}
                        </h3>
                    </div>
                    ${islandNameDhivehi !== "N/A" ? `
                        <div style="font-family: 'Faruma', sans-serif; direction: rtl; text-align: center; font-size: 14px; margin-bottom: 8px; color: #444; background: #FAF5E0; padding: 4px; border-radius: 3px;">
                            ${islandNameDhivehi}
                        </div>
                    ` : ''}
                    <div style="background: #FAF5F0; border-radius: 4px; padding: 10px; margin-bottom: 6px;">
                        <div style="color: #666; margin-bottom: 3px; font-size: 12px;">Atoll: <span style="color: #333; font-weight: 500;">${atollName}</span></div>
                        <div style="color: #666; margin-bottom: 3px; font-size: 12px;">Code: <span style="color: #333; font-weight: 500;">${islandCode}</span></div>
                        <div style="color: #666; margin-bottom: 3px; font-size: 12px;">Category: <span style="color: #333; font-weight: 500;">${category}</span></div>
                        <div style="color: #666; margin-bottom: 3px; font-size: 12px;">Capital: <span style="color: #333; font-weight: 500;">${capital}</span></div>
                        <div style="color: #666; font-size: 12px;">Area: <span style="color: #333; font-weight: 500;">${areaHa} ha</span></div>
                    </div>
                    <div style="font-size: 10px; color: #999; text-align: center; padding-top: 6px; border-top: 1px solid #E5E5E5;">
                        Geomatics Department | onemap.mv
                    </div>
                </div>
            `;
        }

        // Click handler with label highlighting and flood bubble priority
        view.on("click", async (event) => {
            try {
                // First check if clicked on flood bubbles
                const hitResults = await view.hitTest(event);
                const floodHit = hitResults.results.find(r => r.graphic && r.graphic.layer === floodGraphicsLayer);
                
                if (floodHit) {
                    const graphic = floodHit.graphic;
                    view.openPopup({
                        features: [graphic],
                        location: event.mapPoint
                    });
                    return;
                }
                
                // Clear previous highlights
                if (currentHighlight) {
                    highlightLayer.remove(currentHighlight);
                    currentHighlight = null;
                }
                if (currentLabelHighlight) {
                    labelsLayer.remove(currentLabelHighlight);
                    currentLabelHighlight = null;
                }
                
                // Check other layers
                const layers = [islandLayer, lagoonLayer, reefLayer];
                const layerNames = ['island', 'lagoon', 'reef'];
                
                for (let i = 0; i < layers.length; i++) {
                    const query = layers[i].createQuery();
                    query.geometry = event.mapPoint;
                    query.spatialRelationship = "intersects";
                    query.returnGeometry = true;
                    query.outFields = ["*"];
                    query.maxRecordCount = 1;
                    
                    if (layerNames[i] === 'island') {
                        query.distance = 80;
                        query.units = "meters";
                    }
                    
                    const results = await layers[i].queryFeatures(query);
                    
                    if (results.features.length > 0) {
                        const feature = results.features[0];
                        currentHighlight = createExactHighlight(feature.geometry, feature.attributes, layerNames[i]);
                        highlightLayer.add(currentHighlight);
                        
                        if (layerNames[i] === 'island') {
                            const islandName = feature.attributes.islandName;
                            if (islandName) {
                                highlightLabel(islandName, feature.geometry);
                            }
                        }
                        break;
                    }
                }
            } catch (error) {
                console.error('Error:', error);
            }
        });

        // Hover effect , only check local GraphicsLayer (no remote FeatureServer queries)
        let _hoverThrottle = null;
        view.on("pointer-move", (event) => {
            if (_hoverThrottle) return;
            _hoverThrottle = setTimeout(() => { _hoverThrottle = null; }, 80);
            view.hitTest(event, { include: [floodGraphicsLayer] }).then(hit => {
                view.container.style.cursor = hit.results.length > 0 ? "pointer" : "default";
            }).catch(() => {});
        });

        // Initialize
        view.when(() => {
            console.log("Map view ready");
            
            addSmartIslandLabels();
            
            // Only refresh labels when map fully stops , not on every zoom tick
            let _labelDebounce = null;
            view.watch("stationary", (stationary) => {
                if (stationary) {
                    if (_labelDebounce) clearTimeout(_labelDebounce);
                    _labelDebounce = setTimeout(() => addSmartIslandLabels(), 500);
                }
            });
            
            const zoom = new Zoom({ view: view, layout: "vertical" });
            view.ui.add(zoom, "top-right");
            
            const homeBtn = new Home({
                view: view,
                viewpoint: {
                    center: [73.2207, 3.2028],
                    zoom: 8
                }
            });
            view.ui.add(homeBtn, "top-right");
            
            const locateBtn = new Locate({
                view: view,
                useHeadingEnabled: false,
                goToOverride: function(view, options) {
                    options.target.scale = 12000;
                    return view.goTo(options.target);
                }
            });
            view.ui.add(locateBtn, "top-left");
            
            addExactOneMapStyling(container);
            
            // Mark map as ready and trigger bubbles
            window._mapReady = true;
            window._tryFloodBubbles();
        });

        window.arcgisView = view;
        window.floodGraphicsLayer = floodGraphicsLayer;
    });
}

// Add styling
function addExactOneMapStyling(container) {
    const style = document.createElement('style');
    style.textContent = `
        #arcgis-map {
            border-radius: 0;
            width: 100%;
            height: 100%;
        }
        
        .esri-popup__header {
            background: #FFF !important;
            border-bottom: 1px solid #E0E0E0 !important;
            padding: 8px 10px !important;
        }
        
        .esri-popup__header-title {
            font-family: 'Segoe UI', Tahoma, sans-serif !important;
            font-size: 12px !important;
            color: #444 !important;
            font-weight: 400 !important;
        }
        
        .esri-popup__button--close {
            color: #999 !important;
            font-size: 12px !important;
        }
        
        .esri-popup__main-container {
            border: 1px solid #D0D0D0 !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
            border-radius: 3px !important;
        }
        
        .esri-widget--button {
            background: #FFF !important;
            border: 1px solid #CCC !important;
            color: #666 !important;
        }
        
        .esri-widget--button:hover {
            background: #F5F5F5 !important;
        }
        
        .esri-attribution {
            display: none !important;
        }
        
        .map-container {
            border-radius: 0;
            border: 1px solid #E0E0E0;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        
        .esri-view-surface::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(240, 248, 255, 0.2);
            pointer-events: none;
            z-index: 0;
        }
    `;
    document.head.appendChild(style);
}

// Fallback function
function showFallbackMap() {
    console.log('Falling back to SVG map');
    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) {
        mapContainer.innerHTML = `
            <img src="https://upload.wikimedia.org/wikipedia/commons/8/8d/Maldives_location_map.svg" 
                 alt="Maldives Map" 
                 class="maldives-svg-map">
            <div class="grid-overlay-map"></div>
        `;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    console.log('Loading OneMap with flood bubbles...');
    initializeInteractiveMap();
});