// =====================================================================
// app.js - JSON-Driven Parcel Viewer with Management
// =====================================================================
// Description: Displays parcel boundaries (KML), associated satellite
//              imagery (RGB/NDVI tiles) based on dates, allows
//              navigation via time slider, provides NDVI statistics,
//              and includes a form to manage parcel data via JSON.
// =====================================================================

// --- Configuration & Constants ---
const PARCELS_JSON_URL = 'parcels_data.json'; // Central configuration file
const KML_LAYER_URL = 'https://razvan11-cloud.github.io/crop-tiles/Locatii.kml'; // Main KML source
const NDVI_CSV_URL = 'https://raw.githubusercontent.com/razvan11-cloud/crop-tiles/main/ndvi_data.csv'; // NDVI stats source
const DEFAULT_GRID_URL_PATTERN = 'https://raw.githubusercontent.com/razvan11-cloud/crop-tiles/main/grid/{kmlId}/{name}_{date}_grid.geojson'; // Default pattern if not specified in JSON

// --- Map Initialization ---
const map = L.map('map').setView([46.38962839578193, 24.193423798797586], 13.2);

const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    attribution: '© Google Maps',
    maxZoom: 20
}).addTo(map);

// --- Data Storage ---
let allParcelsData = [];        // Holds all parcel objects loaded from PARCELS_JSON_URL
let ndviStatsData = {};         // Holds parsed NDVI statistics { kmlId: { date: { mean, min, max } } }

// --- Application State ---
let currentParcel = null;       // The currently selected parcel object from allParcelsData
let availableDates = [];        // Sorted dates [DD-MM-YYYY] for the currentParcel's RGB layers
let activeTileLayer = null;     // The L.tileLayer instance currently displayed on the map
let kmlLayers = {};             // Stores loaded KML village layers { villageName: L.LayerGroup }
let ndviGridLayer = null;       // The L.geoJSON instance for the NDVI grid overlay
let gridLabels = [];            // Array of L.marker instances for grid labels
let layerControl = null;        // The Leaflet layer control instance
let currentParcelLabel = null;  // Permanent L.tooltip showing the name of the selected parcel
let animationInterval = null;   // Interval ID for the play button animation
let dataHasChanged = false;     // Flag: true if parcel data was modified via the form

// --- UI Element References ---
// Using const assuming these elements exist and won't be reassigned
const timeSlider = document.getElementById("timeSlider");
const dateLabel = document.getElementById("dateLabel");
const sliderContainer = document.getElementById("slider-container");
const playButton = document.getElementById("play-button");
const ndviCheckbox = document.getElementById("ndviCheckbox");
const ndviValuesDiv = document.getElementById("ndvi-values");
const popupCheckbox = document.getElementById("popupCheckbox"); // Controls grid display
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
// "Manage Parcels" Form Elements
const manageParcelsBtn = document.getElementById("manage-parcels-btn");
const addParcelSection = document.getElementById("add-parcel-section");
const closeAddParcelBtn = document.getElementById("close-add-parcel-btn");
const addLayerDateBtn = document.getElementById('addLayerDateBtn');
const newLayersContainer = document.getElementById('newLayersContainer');
const addParcelBtn = document.getElementById('addParcelBtn');
const exportDataBtn = document.getElementById('exportDataBtn');
const clearFormBtn = document.getElementById('clearFormBtn');
const uploadStatus = document.getElementById('uploadStatus');
const layerInputTemplate = document.getElementById('layer-input-template');
// Form Input Fields (Grouped)
const formElements = {
    id: document.getElementById('newParcelId'),
    kmlId: document.getElementById('newKmlId'),
    name: document.getElementById('newParcelName'),
    location: document.getElementById('newParcelLocation'),
    csvAvailable: document.getElementById('newCsvAvailable'),
    gridBaseUrl: document.getElementById('newGridBaseUrl')
};

// =====================================================================
// DATA LOADING FUNCTIONS
// =====================================================================

/**
 * Loads the main parcel configuration data from the JSON file.
 * Sorts the data by location and name upon successful loading.
 * @returns {Promise<boolean>} True if loading and parsing were successful, false otherwise.
 */
async function loadParcelData() {
    console.log(`Attempting to load parcel data from: ${PARCELS_JSON_URL}`);
    try {
        // Add cache-busting parameter
        const response = await fetch(PARCELS_JSON_URL + '?_=' + new Date().getTime());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} fetching ${PARCELS_JSON_URL}`);
        }
        allParcelsData = await response.json();
        // Sort parcels for consistent display (e.g., in search, potentially layer control)
        allParcelsData.sort((a, b) => (a.location + a.name).localeCompare(b.location + b.name));
        console.log("Parcel data loaded successfully:", allParcelsData.length, "records");
        return true;
    } catch (error) {
        console.error("Could not load or parse parcel data:", error);
        alert(`FATAL ERROR: Could not load parcel configuration from ${PARCELS_JSON_URL}. The application cannot function correctly. Please check the file and the console.`);
        return false;
    }
}

/**
 * Loads and parses NDVI statistics from the CSV file using jQuery.ajax.
 * Populates the `ndviStatsData` object.
 * Executes a callback function upon completion (success or error).
 * @param {function} callback - Function to call after attempting to load data.
 */
function loadCsvData(callback) {
    console.log("Attempting to load NDVI CSV data from:", NDVI_CSV_URL);
    $.ajax({
        url: NDVI_CSV_URL + '?_=' + new Date().getTime(), // Cache bust
        dataType: 'text',
        success: function (data) {
            ndviStatsData = {}; // Reset data
            const lines = data.split('\n');
            if (lines.length < 2 || !lines[0].trim()) {
                console.warn('NDVI CSV file appears empty or lacks a header row.');
                callback();
                return;
            }

            const headers = lines[0].trim().split(',');
            // Basic validation: Expect at least PARCEL_NR, DATE, MEAN, MIN, MAX
            if (headers.length < 5) {
                 console.warn('NDVI CSV header seems incomplete. Expected at least 5 columns.');
                 // Continue processing assuming standard columns 0-4
            }

            let parsedCount = 0;
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue; // Skip empty lines

                const values = line.split(',');
                if (values.length === headers.length) { // Ensure correct column count
                    const kmlId = values[0].trim(); // Match JSON kmlId
                    const date = values[1].trim(); // Match JSON layer date format (e.g., DD-MM-YYYY)
                    const mean = parseFloat(values[2]);
                    const min = parseFloat(values[3]);
                    const max = parseFloat(values[4]);

                    // Basic validation of parsed numbers
                    if (kmlId && date && !isNaN(mean) && !isNaN(min) && !isNaN(max)) {
                        if (!ndviStatsData[kmlId]) {
                            ndviStatsData[kmlId] = {};
                        }
                        ndviStatsData[kmlId][date] = { mean, min, max };
                        parsedCount++;
                    } else {
                        // console.warn(`Skipping invalid CSV line ${i + 1}: ${line}`);
                    }
                } else {
                     // console.warn(`Skipping CSV line ${i + 1} due to column mismatch: expected ${headers.length}, got ${values.length}`);
                }
            }
            console.log(`NDVI CSV Data Loaded: Parsed ${parsedCount} valid records.`);
            // console.log("Parsed NDVI Data:", ndviStatsData); // Optional: Log the full data structure
            callback();
        },
        error: function (xhr, status, error) {
            console.error(`Error loading NDVI CSV data from ${NDVI_CSV_URL}:`, status, error);
            // Proceed even if CSV fails, but stats won't be available
            alert(`Warning: Could not load NDVI statistics from ${NDVI_CSV_URL}. NDVI values will show N/A.`);
            callback();
        }
    });
}

// =====================================================================
// UTILITY FUNCTIONS
// =====================================================================

/**
 * Finds a parcel object in the `allParcelsData` array by its `kmlId`.
 * Performs a case-insensitive and trimmed comparison.
 * @param {string | number | null | undefined} kmlId - The KML ID to search for.
 * @returns {object | null} The found parcel object or null if not found or kmlId is invalid.
 */
function findParcelByKmlId(kmlId) {
    if (kmlId === null || kmlId === undefined) return null;
    const searchId = String(kmlId).trim();
    return allParcelsData.find(p => String(p.kmlId).trim() === searchId) || null;
}

/**
 * Normalizes raw NDVI mean values (often 0-255 range) to a 0-1 scale.
 * Assumes a specific formula based on the data source. Adjust if needed.
 * @param {number} value - The raw NDVI mean value.
 * @returns {number} Normalized NDVI value (typically 0 to 1).
 */
function normalizeNDVI(value) {
    // This formula seems specific (127-value)/127 might imply values centered around 127?
    // A more typical normalization might be (value - min) / (max - min) if min/max are known/fixed.
    // Double-check the expected input range and desired output range.
    return  value ; // Using the original formula provided
}

/** Disables map scroll wheel zoom (used for layer control hover). */
function disableMapScrollZoom() { map.scrollWheelZoom.disable(); }
/** Enables map scroll wheel zoom (used for layer control mouseout). */
function enableMapScrollZoom() { map.scrollWheelZoom.enable(); }


// =====================================================================
// KML & MAP INTERACTION
// =====================================================================

/**
 * Loads and displays KML features for a specific village.
 * Filters features based on the VILLAGE property.
 * Styles features based on whether corresponding data exists in `allParcelsData`.
 * Sets up popups and click handlers for each KML feature.
 * @param {string} villageName - The name of the village (must match KML VILLAGE property).
 */
function loadKmlLayer(villageName) {
    // Avoid reloading if already loaded and on map
    if (kmlLayers[villageName] && map.hasLayer(kmlLayers[villageName])) {
        console.log(`KML layer for "${villageName}" is already loaded and visible.`);
        return;
    }
    // Clear any stale reference if the layer was removed previously
    if (kmlLayers[villageName]) {
        console.log(`Clearing stale KML layer reference for "${villageName}".`);
        kmlLayers[villageName] = null;
    }

    console.log(`Attempting to load KML for village: "${villageName}" from ${KML_LAYER_URL}`);
    const kmlLayerInstance = omnivore.kml(KML_LAYER_URL, null, L.geoJson(null, {
        // Filter KML features to only show those matching the requested village
        filter: function(feature) {
            return feature.properties && feature.properties.VILLAGE === villageName;
        },
        // Style KML features
        style: function(feature) {
            const parcelNr = feature.properties?.PARCEL_NR; // Use optional chaining
            const parcelData = findParcelByKmlId(parcelNr);
            // Style differently if data & layers exist in JSON
            const hasDataAndLayers = parcelData?.layers && Object.keys(parcelData.layers).length > 0;
            return {
                color: hasDataAndLayers ? 'blue' : 'red', // Blue if data/layers exist, Red otherwise
                weight: 2,
                fillOpacity: 0 // No fill for boundary polygons
            };
        }
    }))
    .on('ready', function() {
        console.log(`KML features loaded successfully for "${villageName}". Processing features...`);
        let featureCount = 0;
        const villageLayerGroup = L.layerGroup(); // Use a layer group to hold features for this village

        this.eachLayer(function(featureLayer) {
            featureCount++;
            if (featureLayer.feature?.properties) {
                setupKmlFeature(featureLayer, villageName); // Delegate feature setup
                villageLayerGroup.addLayer(featureLayer); // Add to the village-specific group
            }
        });

        if (featureCount === 0) {
            console.warn(`No KML features found with VILLAGE = "${villageName}" in the KML file.`);
            // Optionally remove the placeholder layer if it's empty
            if (layerControl) {
                 // How to remove the placeholder from GroupedLayers? This might be tricky.
                 // For now, it will just be an empty group in the control.
            }
        } else {
            console.log(`Added ${featureCount} KML features for "${villageName}".`);
            kmlLayers[villageName] = villageLayerGroup; // Store the group
            if (!map.hasLayer(villageLayerGroup)) {
                map.addLayer(villageLayerGroup); // Add the whole group to the map
            }
            // Ensure layer control reflects the loaded layer (might need explicit update if using GroupedLayers)
             if (layerControl && layerControl.addOverlay) {
                // This might add it again if GroupedLayers doesn't handle this well. Test needed.
                // layerControl.addOverlay(villageLayerGroup, villageName);
            }
        }
    })
    .on('error', function(error) {
        console.error(`Error loading or processing KML for "${villageName}":`, error);
        alert(`Failed to load map features for ${villageName}. Please check the KML source and console.`);
        kmlLayers[villageName] = null; // Clear reference on error
    });
}

/**
 * Sets up popup, tooltip, and click handler for a single KML feature layer.
 * @param {L.Layer} featureLayer - The Leaflet layer representing the KML feature.
 * @param {string} villageName - The village this feature belongs to.
 */
function setupKmlFeature(featureLayer, villageName) {
    const props = featureLayer.feature.properties;
    const parcelNr = props.PARCEL_NR; // This is the KML ID
    const parcelData = findParcelByKmlId(parcelNr); // Find corresponding JSON data

    // --- Popup Content ---
    let popupContent = `<b>PARCEL_NR (KML ID):</b> ${parcelNr}<br>`;
    if (parcelData) {
        popupContent += `<b>Name:</b> ${parcelData.name || '(N/A)'}<br>`;
        popupContent += `<b>Location:</b> ${parcelData.location || '(N/A)'}<br>`;
        // Add other relevant JSON data if needed
    } else {
        popupContent += `<i style='color:red;'>(No matching data found in JSON)</i><br>`;
    }
    // Add other KML properties
    popupContent += `<b>FARM_ID:</b> ${props.FARM_ID || 'N/A'}<br>`;
    popupContent += `<b>Crop 2024:</b> ${props.CROP_NAME2024 || 'N/A'}<br>`;
    popupContent += `<b>Crop 2025:</b> ${props.CROP_NAME2025 || 'N/A'}<br>`;
    popupContent += `<b>Area (dec.):</b> ${props.AREA_DEC || 'N/A'}<br>`;
    popupContent += `<button type="button" class="edit-parcel-btn" data-kmlid="${parcelNr}">Edit/Add Parcel Data</button>`;
    featureLayer.bindPopup(popupContent);

    // --- Tooltip ---
    // Use KML name if available, otherwise default
    const tooltipText = props.name || `Parcel ${parcelNr}`;
    featureLayer.bindTooltip(tooltipText, { permanent: false, direction: "top" });

    // --- Click Handler ---
    featureLayer.on('click', function(e) {
        L.DomEvent.stopPropagation(e); // Prevent map click event
        const clickedFeatureLayer = e.target;
        const clickedProps = clickedFeatureLayer.feature.properties;
        const clickedParcelNr = clickedProps.PARCEL_NR;
        console.log(`--- KML Feature Clicked ---`);
        console.log(`   Parcel KML ID: ${clickedParcelNr}`);
        console.log(`   Village: ${villageName}`);

        const clickedParcelData = findParcelByKmlId(clickedParcelNr);

        // Remove previous permanent label if it exists
        if (currentParcelLabel) {
            map.removeLayer(currentParcelLabel);
            currentParcelLabel = null;
        }

        // Case 1: Clicked the *same* parcel that is currently active
        if (currentParcel === clickedParcelData && clickedParcelData !== null) {
            console.log(`   Clicked the currently active parcel (${currentParcel?.id}). Clearing selection.`);
            clearParcelSelection();
            // Optionally re-center map? Or just close popup? Map already likely centered.
            map.closePopup(); // Close the popup after clearing
        }
        // Case 2: Clicked a *new* parcel that has valid data and image layers in the JSON
        else if (clickedParcelData?.layers && Object.keys(clickedParcelData.layers).length > 0) {
            console.log(`   Processing NEW valid parcel selection: ID=${clickedParcelData.id}, KML_ID=${clickedParcelNr}`);

            // Clear previous tile layer if any
            if (activeTileLayer) {
                map.removeLayer(activeTileLayer);
                activeTileLayer = null;
            }

            // Set the new current parcel
            currentParcel = clickedParcelData;

            // Extract and sort available dates (only base dates, not NDVI keys)
            availableDates = Object.keys(currentParcel.layers)
                .filter(key => !key.endsWith("-NDVI"))
                .sort((a, b) => {
                     // Robust date sorting (handles DD-MM-YYYY)
                     const [dayA, monthA, yearA] = a.split('-').map(Number);
                     const [dayB, monthB, yearB] = b.split('-').map(Number);
                     return new Date(yearA, monthA - 1, dayA) - new Date(yearB, monthB - 1, dayB);
                 });

            if (availableDates.length > 0) {
                console.log(`   Found ${availableDates.length} dates:`, availableDates);
                setupSlider(); // Configure the slider range and labels
                updateTileLayer(); // Load the initial tile layer for the first date

                // Update NDVI display and Grid based on checkboxes
                updateNdviValuesDisplay();
                displayGridOnCheckbox();

                // Show slider only if multiple dates exist
                sliderContainer.style.display = (availableDates.length > 1) ? 'flex' : 'none';

            } else {
                console.warn(`   Parcel ${currentParcel.id} has a 'layers' object, but no valid date keys found.`);
                alert(`Parcel ${clickedParcelNr} has layer data defined, but no usable image dates were found. Check JSON structure.`);
                clearParcelSelection();
            }
            // Zoom to the clicked feature bounds AFTER processing
            map.fitBounds(clickedFeatureLayer.getBounds());

        }
        // Case 3: Clicked a KML feature with no matching JSON data or no layers defined
        else {
            console.warn(`   Clicked KML feature ${clickedParcelNr} has NO valid data or image layers in the JSON.`);
            clearParcelSelection(); // Clear any previous selection
            alert(`No image layers are available for Parcel ${clickedParcelNr}. Add data using the 'Edit/Add Parcel Data' button in the popup.`);
            // Still zoom to the feature even if no layers are shown
            map.fitBounds(clickedFeatureLayer.getBounds());
        }
        console.log(`--- KML Feature Click End ---`);
    }); // End of click handler
}


// =====================================================================
// LAYER CONTROL
// =====================================================================

/** Handles the 'overlayadd' event from the layer control. */
function handleOverlayAdd(e) {
    const villageName = e.name; // The name/key used in the layer control
    console.log(`Layer Control: ADD overlay requested for "${villageName}"`);
    // Check if this village exists in our parcel data (optional, but good practice)
    const villageExistsInData = allParcelsData.some(p => p.location === villageName);
    if (villageExistsInData) {
        loadKmlLayer(villageName); // Load the corresponding KML features
    } else {
        console.warn(`Layer control added for "${villageName}", but no matching location found in parcel data.`);
        // Optionally provide feedback to the user or prevent adding?
    }
}

/** Handles the 'overlayremove' event from the layer control. */
function handleOverlayRemove(e) {
    const villageName = e.name;
    console.log(`Layer Control: REMOVE overlay requested for "${villageName}"`);
    if (kmlLayers[villageName] && map.hasLayer(kmlLayers[villageName])) {
        map.removeLayer(kmlLayers[villageName]);
        console.log(`   Removed KML layer for "${villageName}" from map.`);
    }
    // We might still keep the reference in kmlLayers unless we are sure it won't be added again
    // kmlLayers[villageName] = null; // Clear the reference

    // If the currently selected parcel belongs to the removed village, clear the selection
    if (currentParcel && currentParcel.location === villageName) {
        console.log(`   Clearing current parcel selection as its village layer was removed.`);
        clearParcelSelection();
    }
}

/**
 * Initializes or re-initializes the Leaflet Layer Control.
 * Groups KML layers by village name based on `allParcelsData`.
 */
function initializeLayerControl() {
    console.log("--- Initializing Layer Control ---");
    // Remove existing control if it exists
    if (layerControl) {
        try {
            map.removeControl(layerControl);
            map.off('overlayadd', handleOverlayAdd);
            map.off('overlayremove', handleOverlayRemove);
            console.log("   Removed existing layer control.");
        } catch (e) {
             console.warn("   Error removing previous layer control:", e);
        }
        layerControl = null;
    }

    // Define Base Layers
    const baseLayers = {
        "Google Hybrid": googleHybrid
        // Add other base layers here if needed
    };

    // --- MODIFIED SECTION START ---
    // Create Overlay Layers grouped under a single category

    // Get unique locations from JSON data
    const uniqueLocations = [...new Set(allParcelsData.map(p => p.location).filter(Boolean))].sort();

    // Initialize the overlay structure with ONE group
    const groupedOverlays = {
        "Locations": {} // Create a single group named "Locations" (or choose another name)
    };

    if (uniqueLocations.length > 0) {
        uniqueLocations.forEach(locName => {
            // Add each location's placeholder layer under the "Locations" group
            // The key 'locName' will be the checkbox label
            // The value is the placeholder layer group
            groupedOverlays["Locations"][locName] = L.layerGroup();
        });

        console.log(`   Created overlay group "Locations" with entries for: ${uniqueLocations.join(', ')}`);

        layerControl = L.control.groupedLayers(baseLayers, groupedOverlays, {
            collapsed: true, // Keep the control expanded initially
            // groupCheckboxes: true, // This might not be needed with only one group, but doesn't hurt
            position: 'topleft'
        }).addTo(map);

        // Add event listeners AFTER the control is created
        map.on('overlayadd', handleOverlayAdd);
        map.on('overlayremove', handleOverlayRemove);

        // Add hover effect to disable map scroll zoom over the layer control
        const container = layerControl.getContainer();
        if (container) {
            container.addEventListener('mouseover', disableMapScrollZoom);
            container.addEventListener('mouseout', enableMapScrollZoom);
        }
        console.log("   Initialized Grouped Layer Control.");

    // --- MODIFIED SECTION END ---

    } else {
         console.warn("   No locations found in parcel data. Initializing Layer Control with only base layers.");
        layerControl = L.control.layers(baseLayers, null, { position: 'topleft' }).addTo(map);
    }
    console.log("--- Layer Control Initialization Complete ---");
}


// =====================================================================
// UI UPDATES & STATE MANAGEMENT
// =====================================================================

/**
 * Clears the current parcel selection and resets related UI elements.
 */
function clearParcelSelection() {
    console.log("--- Clearing Parcel Selection ---");
    // Remove imagery layer
    if (activeTileLayer && map.hasLayer(activeTileLayer)) {
        map.removeLayer(activeTileLayer);
    }
    activeTileLayer = null;

    // Remove permanent label
    if (currentParcelLabel && map.hasLayer(currentParcelLabel)) {
        map.removeLayer(currentParcelLabel);
    }
    currentParcelLabel = null;

    // Remove grid overlay
    removeGrid();

    // Reset state variables
    currentParcel = null;
    availableDates = [];

    // Reset UI elements
    sliderContainer.style.display = 'none';
    ndviValuesDiv.style.display = 'none';
    if (playButton) playButton.textContent = "Play"; // Reset play button
    if (animationInterval) clearInterval(animationInterval); animationInterval = null;

    // Reset slider to default state
    setupSlider(); // This will hide it as availableDates is empty

    console.log("--- Parcel Selection Cleared ---");
}

/**
 * Sets up the time slider based on the `availableDates` for the `currentParcel`.
 * Hides the slider if no dates or only one date is available.
 */
function setupSlider() {
    if (currentParcel && availableDates && availableDates.length > 0) {
        timeSlider.min = 0;
        timeSlider.max = availableDates.length - 1;

        // Try to keep the current slider value if valid, otherwise reset to 0
        let currentValue = parseInt(timeSlider.value);
        if (isNaN(currentValue) || currentValue >= availableDates.length || currentValue < 0) {
            timeSlider.value = 0; // Default to the first date
        }

        // Update the date label immediately
        dateLabel.textContent = availableDates[timeSlider.value];

        // Show slider only if there's more than one date to slide through
        sliderContainer.style.display = (availableDates.length > 1) ? 'flex' : 'none';
        console.log(`Slider setup: ${availableDates.length} dates. Min=0, Max=${timeSlider.max}, CurrentVal=${timeSlider.value}`);
    } else {
        // Reset slider when no parcel is selected or no dates available
        timeSlider.min = 0;
        timeSlider.max = 0;
        timeSlider.value = 0;
        dateLabel.textContent = "No date";
        sliderContainer.style.display = 'none';
         console.log("Slider setup: No dates available. Hiding slider.");
    }
}

/**
 * Updates or creates the main tile layer based on the current parcel, selected date, and NDVI checkbox state.
 * Uses the layer URLs defined in the `currentParcel.layers` object.
 */
function updateTileLayer() {
    console.log(`--- Updating Tile Layer ---`);
    if (!currentParcel || availableDates.length === 0) {
        console.warn("   Skipped: No current parcel selected or no available dates.");
        // Ensure layer is removed if selection was cleared but this func was called somehow
        if (activeTileLayer && map.hasLayer(activeTileLayer)) map.removeLayer(activeTileLayer);
        activeTileLayer = null;
        return;
    }

    // Get selected date from slider
    let selectedDateIndex = parseInt(timeSlider.value);
    // Validate index, default to 0 if invalid
    if (isNaN(selectedDateIndex) || selectedDateIndex < 0 || selectedDateIndex >= availableDates.length) {
        console.warn(`   Invalid slider index (${selectedDateIndex}). Resetting to 0.`);
        selectedDateIndex = 0;
        timeSlider.value = 0;
    }
    const selectedDate = availableDates[selectedDateIndex];
    dateLabel.textContent = selectedDate; // Update label shown to user

    // Determine if NDVI layer is requested
    const useNDVI = ndviCheckbox.checked;

    // Construct the key to look up the URL in the parcel's layers object
    let urlKey = selectedDate + (useNDVI ? "-NDVI" : "");
    let tileUrl = currentParcel.layers?.[urlKey]; // Safely access nested property

    console.log(`   Parcel ID: ${currentParcel.id}, KML ID: ${currentParcel.kmlId}`);
    console.log(`   Selected Date: ${selectedDate} (Index: ${selectedDateIndex})`);
    console.log(`   NDVI Checked: ${useNDVI}`);
    console.log(`   Looking for URL key: "${urlKey}"`);

    // --- Fallback Logic ---
    // If NDVI is checked but the specific NDVI layer URL doesn't exist, fall back to RGB for that date
    if (!tileUrl && useNDVI) {
        console.warn(`   NDVI layer URL for key "${urlKey}" not found. Attempting to fall back to RGB layer for date ${selectedDate}.`);
        urlKey = selectedDate; // Key for the RGB layer
        tileUrl = currentParcel.layers?.[urlKey];
        if (tileUrl) {
             console.log(`   Fallback successful: Using RGB URL for key "${urlKey}".`);
             // Optionally uncheck the NDVI box visually? Or indicate fallback?
             // ndviCheckbox.checked = false; // This might confuse the user. Better to show message?
             // dateLabel.textContent = `${selectedDate} (NDVI N/A)`; // Indicate fallback
        }
    }

    // --- Update or Create Layer ---
    if (tileUrl) {
        console.log(`   Using Tile URL: ${tileUrl}`);
        if (activeTileLayer) {
            // If a layer already exists, just update its URL
            console.log(`   Updating URL of existing activeTileLayer.`);
            activeTileLayer.setUrl(tileUrl);
            // Ensure it's visible (it might have been removed previously)
             if (!map.hasLayer(activeTileLayer)) {
                  map.addLayer(activeTileLayer);
             }
        } else {
            // If no layer exists, create a new one
            console.log(`   Creating NEW tile layer.`);
            activeTileLayer = L.tileLayer(tileUrl, {
                minZoom: 10, // Adjust as needed
                maxZoom: 21, // Adjust as needed
                maxNativeZoom: 20, // Adjust based on your tile source
                opacity: 1.0 // Default opacity
                // Add other tilelayer options here (tms, attribution, etc.) if needed
            }).addTo(map);
        }
        // Bring KML layers to front if needed (optional)
        // Object.values(kmlLayers).forEach(layer => layer?.bringToFront());
    } else {
        // Critical: No URL found even after fallback
        console.error(`   FINAL ERROR: No valid tile URL found for parcel ${currentParcel.id} for date ${selectedDate} (checked NDVI: ${useNDVI}). Removing any active layer.`);
        if (activeTileLayer && map.hasLayer(activeTileLayer)) {
            map.removeLayer(activeTileLayer);
        }
        activeTileLayer = null;
        dateLabel.textContent = `${selectedDate} (Image N/A)`; // Indicate missing image
        // Optionally alert the user
         alert(`Image data for parcel ${currentParcel.name} on ${selectedDate} ${useNDVI ? '(NDVI requested)' : ''} is missing. Check the configuration.`);
    }

    // Update dependent UI elements *after* determining the layer
    updateNdviValuesDisplay();
    displayGridOnCheckbox(); // Grid display might depend on the date

    console.log(`--- Tile Layer Update Complete ---`);
}


/**
 * Updates the display area for NDVI statistics (mean, min, max).
 * Uses data from `ndviStatsData` based on `currentParcel` and selected date.
 */
function updateNdviValuesDisplay() {
    // Hide the div initially
    ndviValuesDiv.style.display = 'none';
    $("#mean-value").text("N/A"); // Use jQuery selectors as per original code
    $("#min-value").text("N/A");
    $("#max-value").text("N/A");

    // Check prerequisites
    if (!ndviCheckbox.checked || !currentParcel || !currentParcel.csvAvailable) {
        // Don't show if NDVI isn't checked, no parcel selected, or JSON indicates no CSV data expected
        return;
    }

    // Get current date from slider
    const selectedDateIndex = parseInt(timeSlider.value);
    if (isNaN(selectedDateIndex) || selectedDateIndex < 0 || selectedDateIndex >= availableDates.length) {
        console.warn("NDVI Display: Invalid date index.");
        ndviValuesDiv.style.display = 'block'; // Show the panel but with N/A values
        return;
    }
    const selectedDate = availableDates[selectedDateIndex];
    const parcelKmlId = currentParcel.kmlId; // Use KML ID to look up in CSV data

    // Find the data in the loaded ndviStatsData
    const stats = ndviStatsData?.[parcelKmlId]?.[selectedDate];

    if (stats) {
         console.log(`NDVI Display: Found stats for KML ID ${parcelKmlId}, Date ${selectedDate}:`, stats);
        $("#mean-value").text(stats.mean.toFixed(3));
        $("#min-value").text(stats.min.toFixed(3));
        $("#max-value").text(stats.max.toFixed(3));
    } else {
        console.warn(`NDVI Display: No stats found for KML ID ${parcelKmlId}, Date ${selectedDate}`);
        // Values remain "N/A"
    }

    // Show the NDVI values panel
    ndviValuesDiv.style.display = 'block';
}


// =====================================================================
// GRID DISPLAY FUNCTIONS
// =====================================================================

/** Removes the currently displayed grid overlay and its labels from the map. */
function removeGrid() {
    if (ndviGridLayer && map.hasLayer(ndviGridLayer)) {
        map.removeLayer(ndviGridLayer);
        console.log("Removed existing grid layer.");
    }
    ndviGridLayer = null;

    gridLabels.forEach(label => map.removeLayer(label));
    gridLabels = [];
    // console.log("Cleared grid labels.");
}

/**
 * Fetches and displays the GeoJSON grid overlay if the checkbox is checked.
 * Uses the grid URL derived from `currentParcel` data or the default pattern.
 * Creates labels showing normalized NDVI and elevation for each grid cell.
 */
/**
 * Fetches and displays the GeoJSON grid overlay if the checkbox is checked.
 * Uses the grid URL derived from `currentParcel` data or the default pattern.
 * Creates labels showing normalized NDVI and elevation for each grid cell.
 * **Includes date reformatting to match MM-DD-YYYY filenames.**
 */
function displayGridOnCheckbox() {
    removeGrid(); // Always remove the old grid first

    // Check prerequisites
    if (!popupCheckbox.checked || !currentParcel || !currentParcel.layers || availableDates.length === 0) {
        console.log("[GRID] Grid display skipped: Checkbox off, no parcel, or no dates.");
        return;
    }

    // Get current date from availableDates (assuming DD-MM-YYYY format)
    let selectedDateIndex = parseInt(timeSlider.value);
    if (isNaN(selectedDateIndex) || selectedDateIndex < 0 || selectedDateIndex >= availableDates.length) {
        console.warn("[GRID] Grid display skipped: Invalid date index.");
        return;
    }
    let selectedDate_DDMMYYYY = availableDates[selectedDateIndex]; // Original format: DD-MM-YYYY

    // --- !!! REFORMAT DATE TO MM-DD-YYYY FOR FILENAME !!! ---
    let dateFormattedForFile = '';
    try {
        const parts = selectedDate_DDMMYYYY.split('-'); // Split DD-MM-YYYY
        if (parts.length === 3) {
            // Reassemble as MM-DD-YYYY
            dateFormattedForFile = `${parts[1]}-${parts[0]}-${parts[2]}`; // Swap Day (parts[0]) and Month (parts[1])
             console.log(`[GRID] Original Date (DD-MM-YYYY)=${selectedDate_DDMMYYYY}, Reformatted for Filename (MM-DD-YYYY)=${dateFormattedForFile}`);
        } else {
            console.error("[GRID] Could not parse date for reformatting:", selectedDate_DDMMYYYY);
            dateFormattedForFile = selectedDate_DDMMYYYY; // Fallback to original if parsing fails
        }
    } catch (dateError) {
         console.error("[GRID] Error reformatting date:", dateError);
         dateFormattedForFile = selectedDate_DDMMYYYY; // Fallback
    }
    // --- !!! END OF REFORMATTING !!! ---


    // Get parcel identifiers needed for URL
    let parcelKmlId = currentParcel.kmlId;
    let parcelName = currentParcel.name;
    if (!parcelKmlId || !parcelName) {
         console.warn("[GRID] Grid display skipped: Missing kmlId or name in current parcel data.");
         return;
    }

    // Prepare components for the URL
    let nameForUrl = encodeURIComponent(parcelName.replace(/ /g, '_'));

    // Determine the GeoJSON URL using the REFORMATTED date
    let geojsonUrl;
    if (currentParcel.gridBaseUrl) {
        // Use specific base URL from JSON if provided
        geojsonUrl = `${currentParcel.gridBaseUrl}/${nameForUrl}_${dateFormattedForFile}_grid.geojson`; // Use MM-DD-YYYY
         console.log(`[GRID] Using custom grid base URL from JSON: ${currentParcel.gridBaseUrl}`);
    } else {
        // Use the default pattern
        geojsonUrl = DEFAULT_GRID_URL_PATTERN
            .replace('{kmlId}', parcelKmlId)
            .replace('{name}', nameForUrl)
            .replace('{date}', dateFormattedForFile); // Use MM-DD-YYYY
         console.log(`[GRID] Using default grid URL pattern.`);
    }

    // Add cache-busting parameter
    geojsonUrl += '?_=' + new Date().getTime();
    console.log("[GRID] Attempting to load grid GeoJSON from:", geojsonUrl); // This URL should now use MM-DD-YYYY format

    // --- Fetch and process ---
    fetch(geojsonUrl)
        .then(response => {
            if (!response.ok) {
                // Throw error including the URL that failed
                throw new Error(`HTTP error! status: ${response.status} fetching grid ${geojsonUrl}`);
            }
            return response.json();
        })
        .then(data => {
            // Check context validity
            if (!map || !currentParcel || currentParcel.kmlId !== parcelKmlId || !popupCheckbox.checked) {
                console.log("[GRID] Grid data received, but context changed or checkbox unchecked. Discarding grid.");
                removeGrid();
                return;
            }

            console.log("[GRID] Grid GeoJSON loaded successfully. Creating layer...");
            ndviGridLayer = L.geoJSON(data, {
                style: { /* Style */
                    fillColor: 'transparent', weight: 0.5, color: '#555', fillOpacity: 0
                },
                onEachFeature: function(feature, layer) {
                    //const ndviValue = feature.properties?._ndvimean ?? feature.properties?.NDVI_MEAN; // Adjust keys if needed
                    const ndviValue = feature.properties?._NDVImean;
                    const elevation = feature.properties?._ELEVmean;
                    //const elevation = feature.properties?.SAMPLE_1 ?? feature.properties?.ELEVATION; // Adjust keys if needed

                    if (ndviValue !== undefined && elevation !== undefined && !isNaN(ndviValue) && !isNaN(elevation)) {
                        try {
                            const normalizedNdvi = normalizeNDVI(parseFloat(ndviValue));
                            const center = layer.getBounds().getCenter();
                            const labelIcon = L.divIcon({
                                className: 'grid-label',
                                html: `<div>${normalizedNdvi.toFixed(3)}</div><div class="grid-label-elevation">${Number(elevation).toFixed(1)}</div>`,
                                iconSize: [35, 20], iconAnchor: [18, 10]
                            });
                            const label = L.marker(center, { icon: labelIcon });
                            gridLabels.push(label);
                        } catch (e) {
                            console.error("[GRID] Error processing grid feature properties:", e, feature.properties);
                        }
                    }
                }
            }).addTo(map);

            gridLabels.forEach(label => label.addTo(map));
            console.log(`[GRID] Displayed grid with ${gridLabels.length} labels.`);

        }).catch(error => {
            console.error('[GRID] Error loading or processing GeoJSON grid:', error); // Log the fetch/parse error
            removeGrid();
        });
}


// =====================================================================
// SEARCH FUNCTIONALITY
// =====================================================================

/**
 * Searches for a parcel based on the input value.
 * Prioritizes searching `allParcelsData` (by name, kmlId, location, id).
 * If found in JSON, attempts to find the corresponding KML feature if its village layer is loaded.
 * If not found in JSON, falls back to searching visible KML feature properties directly (less reliable).
 */
function searchLocation() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    if (!searchTerm) return;
    console.log("--- Searching for:", searchTerm, "---");

    let foundParcelData = null;
    let foundKmlLayer = null;

    // --- Stage 1: Search within loaded JSON data ---
    for (const parcel of allParcelsData) {
        // Construct a string of searchable fields for the parcel
        const searchableText = `
            ${parcel.name || ''}
            ${parcel.kmlId || ''}
            ${parcel.location || ''}
            ${parcel.id || ''}
        `.toLowerCase();

        if (searchableText.includes(searchTerm)) {
            foundParcelData = parcel;
            console.log(`   Found match in JSON data: Parcel ID=${foundParcelData.id}, KML_ID=${foundParcelData.kmlId}, Name=${foundParcelData.name}`);
            break; // Stop after first match
        }
    }

    // --- Stage 2: Process JSON match ---
    if (foundParcelData) {
        const village = foundParcelData.location;
        // Check if the KML layer for the parcel's village is loaded and on the map
        if (kmlLayers[village] && map.hasLayer(kmlLayers[village])) {
            console.log(`   Village layer "${village}" is loaded. Searching for KML feature with KML_ID=${foundParcelData.kmlId}...`);
            kmlLayers[village].eachLayer(function(layer) {
                if (layer.feature && String(layer.feature.properties?.PARCEL_NR).trim() === String(foundParcelData.kmlId).trim()) {
                    foundKmlLayer = layer;
                    return false; // Stop iterating once found
                }
            });

            if (foundKmlLayer) {
                console.log(`   Found matching KML feature. Zooming and triggering click.`);
                map.fitBounds(foundKmlLayer.getBounds());
                // foundKmlLayer.openPopup(); // Opening popup is handled by the click event
                foundKmlLayer.fire('click'); // Simulate click to select the parcel
                return; // Search successful
            } else {
                 console.warn(`   Found parcel data in JSON, but couldn't find the corresponding KML feature in the loaded "${village}" layer.`);
                 alert(`Found data for '${foundParcelData.name}', but its shape (KML ID: ${foundParcelData.kmlId}) could not be located on the map within the '${village}' layer. The KML might be missing this feature or the ID might mismatch.`);
                 return;
            }
        } else {
            console.log(`   Found parcel data in JSON, but the KML layer for its village ("${village}") is not currently loaded/visible.`);
            alert(`Found data for '${foundParcelData.name}' in location '${village}'. Please enable the '${village}' layer in the layer control to see its location on the map.`);
            // Optionally, try to programmatically enable the layer?
            // This is complex with GroupedLayers, might require finding the checkbox and clicking it.
            return;
        }
    }

    // --- Stage 3: Fallback - Search visible KML features directly (if no JSON match) ---
    // This searches properties of currently visible KML shapes. Less reliable as it depends on what layers are active.
    console.log("   No match found in JSON data. Falling back to searching visible KML features...");
    let fallbackFound = false;
    const visibleKmlLayers = Object.values(kmlLayers).filter(layer => layer && map.hasLayer(layer));

    for (const kmlLayerGroup of visibleKmlLayers) {
        if (fallbackFound) break; // Stop if already found in another group
        kmlLayerGroup.eachLayer(function(layer) {
             if (layer.feature?.properties) {
                const props = layer.feature.properties;
                // Search common KML properties
                const kmlSearchableText = `
                    ${props.PARCEL_NR || ''}
                    ${props.name || ''}
                    ${props.FARM_ID || ''}
                    ${props.VILLAGE || ''}
                    ${props.CROP_NAME2024 || ''}
                    ${props.CROP_NAME2025 || ''}
                `.toLowerCase();

                 if (kmlSearchableText.includes(searchTerm)) {
                     console.log(`   Found fallback match in visible KML feature: KML_ID=${props.PARCEL_NR}, Name=${props.name}`);
                     map.fitBounds(layer.getBounds());
                     layer.openPopup(); // Open popup directly for fallback matches
                     // Don't fire 'click' here, as it might trigger unwanted layer loading if no JSON data exists
                     fallbackFound = true;
                     return false; // Stop iterating within this group
                 }
             }
         });
    }

    // --- Stage 4: No Results ---
    if (!fallbackFound) {
         console.log("   Search term not found in JSON data or visible KML features.");
        alert(`Location "${searchInput.value}" not found.`);
    }
     console.log("--- Search Complete ---");
}


// =====================================================================
// PLAY BUTTON FUNCTIONALITY
// =====================================================================

/**
 * Handles the Play/Stop button click for animating through dates.
 */
function handlePlayButtonClick() {
    if (animationInterval) {
        // --- Stop Animation ---
        clearInterval(animationInterval);
        animationInterval = null;
        playButton.textContent = "Play";
        console.log("Date animation stopped.");
    } else {
        // --- Start Animation ---
        if (!currentParcel || availableDates.length < 2) {
            console.log("Play button clicked, but not enough dates to animate.");
            return; // Need at least two dates to animate
        }

        playButton.textContent = "Stop";
        console.log("Date animation started.");
        let currentIndex = parseInt(timeSlider.value); // Start from current slider position

        animationInterval = setInterval(() => {
            // Increment index, loop back to 0 if it exceeds max
            currentIndex = (currentIndex + 1) % availableDates.length;
            timeSlider.value = currentIndex;

            // Dispatch events to trigger updates
            // 'input' updates the label immediately, 'change' updates the tile layer
            timeSlider.dispatchEvent(new Event('input'));
            timeSlider.dispatchEvent(new Event('change'));

        }, 1000); // Change image every 1 second (adjust as needed)
    }
}


// =====================================================================
// MANAGE PARCELS FORM LOGIC (REVISED)
// =====================================================================

/**
 * Sets up event listeners and handlers for the "Manage Parcels" form.
 */
function setupAddParcelForm() {
    console.log("[FORM SETUP] Initializing 'Manage Parcels' form listeners...");

    // --- Basic Form Visibility ---
    manageParcelsBtn.addEventListener('click', () => {
        console.log("[FORM ACTION] 'Manage Parcels' button clicked.");
        addParcelSection.style.display = 'flex';
        clearAddParcelForm(false); // Clear form when opening, don't show message
        uploadStatus.textContent = 'Enter new parcel data or load existing via Edit button.';
        uploadStatus.style.color = 'gray';
        exportDataBtn.disabled = !dataHasChanged;
    });

    closeAddParcelBtn.addEventListener('click', () => {
        console.log("[FORM ACTION] 'Close' button clicked.");
        addParcelSection.style.display = 'none';
    });

    clearFormBtn.addEventListener('click', () => {
        console.log("[FORM ACTION] 'Clear Form' button clicked.");
        clearAddParcelForm(true);
    });


    // --- Dynamic Layer Inputs ---
    addLayerDateBtn.addEventListener('click', () => {
        console.log("[FORM ACTION] 'Add Layer Date' button clicked.");
        addLayerInputRow();
    });

    // --- Main Form Actions ---
    addParcelBtn.addEventListener('click', handleAddUpdateParcel);
    exportDataBtn.addEventListener('click', handleExportData);

    // --- Edit Button in Popups ---
    map.on('popupopen', function(e) {
        console.log("[POPUP] Event 'popupopen' triggered.");
        const popupNode = e.popup._container;
        if (!popupNode) {
            console.warn("[POPUP] Popup container node not found.");
            return;
        }

        const editButton = popupNode.querySelector('.edit-parcel-btn');
        if (editButton) {
            console.log("[POPUP] Found 'edit-parcel-btn' in popup.");

            // --- Get village name ---
            let villageName = null;
            let kmlIdFromPopup = null;
            if (e.popup._source?.feature?.properties) {
                villageName = e.popup._source.feature.properties.VILLAGE;
                kmlIdFromPopup = e.popup._source.feature.properties.PARCEL_NR; // Also get KML ID here for logging
                console.log(`[POPUP] Feature Properties: KML_ID=${kmlIdFromPopup || 'N/A'}, VILLAGE=${villageName || 'N/A'}`);
            } else {
                 console.warn("[POPUP] Could not determine village/kmlId from popup source feature.");
            }

            // --- IMPORTANT: Define the ACTUAL handler function HERE ---
            // This ensures it's unique for each popup instance and captures the correct villageName
            const specificEditButtonHandler = (event) => {
                 console.log(`[POPUP BUTTON CLICK] Edit button clicked! KML ID from attribute: ${event.target.getAttribute('data-kmlid')}`);
                handleEditButtonClick(event, villageName); // Call the main logic handler
            };

            // --- Clean up previous listener (if any) ---
            // Check if we stored a previous handler reference on the button
            if (editButton._leaflet_clickHandler) {
                console.log("[POPUP] Removing previous click listener from button.");
                L.DomEvent.off(editButton, 'click', editButton._leaflet_clickHandler);
            }

            // --- Attach the NEW listener ---
            console.log("[POPUP] Attaching NEW click listener to button.");
            L.DomEvent.on(editButton, 'click', specificEditButtonHandler);

            // --- Store the reference for potential cleanup later ---
            editButton._leaflet_clickHandler = specificEditButtonHandler;

        } else {
            console.log("[POPUP] 'edit-parcel-btn' NOT found in popup.");
        }
    });

    // --- Helper Functions defined within setupAddParcelForm scope ---

    /**
     * Handles the click event logic for the "Edit/Add Parcel Data" button.
     * Separated from the listener attachment for clarity.
     * @param {Event} event - The click event object.
     * @param {string | null} villageName - The village name derived from the KML feature.
     */
    function handleEditButtonClick(event, villageName) {
        console.log("[EDIT HANDLER] handleEditButtonClick executing...");
        const kmlIdToEdit = event.target.getAttribute('data-kmlid');
        console.log(`[EDIT HANDLER] KML ID to Edit/Add: ${kmlIdToEdit}, Village from KML: ${villageName || 'N/A'}`);

        if (!kmlIdToEdit) {
            console.error("[EDIT HANDLER] Error: Could not get KML ID from button's data-kmlid attribute!");
            alert("Error: Could not identify the parcel to edit. KML ID missing.");
            return;
        }

        const parcelToEdit = findParcelByKmlId(kmlIdToEdit);
        console.log(`[EDIT HANDLER] Result of findParcelByKmlId:`, parcelToEdit);

        if (parcelToEdit) {
            // --- Edit Existing Parcel ---
            console.log(`[EDIT HANDLER] Parcel found in JSON (ID: ${parcelToEdit.id}). Populating form for editing.`);
            try {
                populateFormForEdit(parcelToEdit);
                map.closePopup();
                 console.log("[EDIT HANDLER] Form populated for editing.");
            } catch (error) {
                 console.error("[EDIT HANDLER] Error during populateFormForEdit:", error);
                 alert("An error occurred while trying to load data into the form. Check the console.");
            }
        } else {
            // --- Add New Parcel Record ---
            console.log(`[EDIT HANDLER] No parcel found in JSON for KML ID ${kmlIdToEdit}. Preparing form for new entry.`);
            try {
                clearAddParcelForm(false);
                formElements.kmlId.value = kmlIdToEdit;

                if (villageName) {
                    formElements.location.value = villageName;
                    console.log(`[EDIT HANDLER] Pre-filled Location field with KML Village: ${villageName}`);
                } else {
                    formElements.location.value = '';
                    console.warn("[EDIT HANDLER] Could not pre-fill Location field (village name unknown).");
                }

                addParcelSection.style.display = 'flex';
                uploadStatus.textContent = `Adding NEW record for KML ID: ${kmlIdToEdit}. Fill required fields (*).`;
                uploadStatus.style.color = 'orange';
                formElements.id.focus();
                map.closePopup();
                 console.log("[EDIT HANDLER] Form prepared for adding new record.");
            } catch (error) {
                 console.error("[EDIT HANDLER] Error during form preparation for new entry:", error);
                 alert("An error occurred while trying to prepare the form. Check the console.");
            }
        }
         exportDataBtn.disabled = !dataHasChanged;
    }

    /**
     * Adds a new row of inputs (Date, RGB URL, NDVI URL) to the layers section of the form.
     * @param {object} [data={ date: '', rgb: '', ndvi: '' }] - Optional data to pre-fill the row.
     */
    function addLayerInputRow(data = { date: '', rgb: '', ndvi: '' }) {
        // console.log("[FORM UTIL] Adding layer input row with data:", data); // Can be noisy, uncomment if needed
        if (!layerInputTemplate) { console.error("[FORM UTIL] Layer input template not found!"); return; }
        try {
            const templateContent = layerInputTemplate.content.cloneNode(true);
            const rowDiv = templateContent.querySelector('.layer-input-row');
            rowDiv.querySelector('.newLayerDate').value = data.date;
            rowDiv.querySelector('.newLayerRgbUrl').value = data.rgb;
            rowDiv.querySelector('.newLayerNdviUrl').value = data.ndvi;
            const removeBtn = rowDiv.querySelector('.removeLayerDateBtn');
            removeBtn.addEventListener('click', () => {
                 console.log("[FORM ACTION] 'Remove Layer' button clicked.");
                 rowDiv.remove();
                  if (newLayersContainer.children.length === 0) { addLayerInputRow(); }
            });
            newLayersContainer.appendChild(templateContent);
        } catch (error) { console.error("[FORM UTIL] Error adding layer input row:", error); }
    }

    /**
     * Populates the "Manage Parcels" form with data from an existing parcel object.
     * @param {object} parcelData - The parcel object from `allParcelsData`.
     */
    function populateFormForEdit(parcelData) {
         console.log("[FORM UTIL] Populating form for edit with data:", parcelData);
         if(!parcelData) {
             console.error("[FORM UTIL] populateFormForEdit called with null/undefined parcelData!");
             return;
         }
        clearAddParcelForm(false);
        formElements.id.value = parcelData.id || '';
        formElements.kmlId.value = parcelData.kmlId || '';
        formElements.name.value = parcelData.name || '';
        formElements.location.value = parcelData.location || '';
        formElements.csvAvailable.checked = parcelData.csvAvailable || false;
        formElements.gridBaseUrl.value = parcelData.gridBaseUrl || '';
        formElements.id.readOnly = true;
        formElements.id.style.backgroundColor = '#eee';

        if (parcelData.layers) {
             const dates = Object.keys(parcelData.layers)
                .filter(key => !key.endsWith('-NDVI'))
                .sort((a, b) => {
                     const [dayA, monthA, yearA] = a.split('-').map(Number);
                     const [dayB, monthB, yearB] = b.split('-').map(Number);
                     return new Date(yearA, monthA - 1, dayA) - new Date(yearB, monthB - 1, dayB);
                 });
              console.log("[FORM UTIL] Populating layers:", dates);
             dates.forEach(date => { addLayerInputRow({ date: date, rgb: parcelData.layers[date] || '', ndvi: parcelData.layers[date + '-NDVI'] || '' }); });
        } else {
             console.log("[FORM UTIL] No layers found in parcel data to populate.");
        }

         if (newLayersContainer.children.length === 0) {
             console.log("[FORM UTIL] No layers populated, adding one empty row.");
             addLayerInputRow();
         }
        addParcelSection.style.display = 'flex';
        uploadStatus.textContent = `Editing Parcel ID: ${parcelData.id} (Name: ${parcelData.name}). KML ID: ${parcelData.kmlId}.`;
        uploadStatus.style.color = 'purple';
         console.log("[FORM UTIL] Form population complete.");
    }

    /**
     * Clears all fields in the "Manage Parcels" form and resets its state.
     * @param {boolean} showMsg - If true, displays a "Form cleared" message.
     */
    function clearAddParcelForm(showMsg) {
         console.log("[FORM UTIL] Clearing add/edit parcel form.");
        formElements.id.value = '';
        formElements.kmlId.value = '';
        formElements.name.value = '';
        formElements.location.value = '';
        formElements.csvAvailable.checked = false;
        formElements.gridBaseUrl.value = '';
        newLayersContainer.innerHTML = '';
        addLayerInputRow(); // Add back one empty row
        formElements.id.readOnly = false;
        formElements.id.style.backgroundColor = '';
        uploadStatus.textContent = showMsg ? 'Form cleared.' : '';
        uploadStatus.style.color = 'gray';
        formElements.id.style.borderColor = '';
        formElements.kmlId.style.borderColor = '';
        formElements.name.style.borderColor = '';
        formElements.location.style.borderColor = '';
        newLayersContainer.querySelectorAll('.newLayerDate, .newLayerRgbUrl, .newLayerNdviUrl').forEach(input => input.style.borderColor = '');
    }

    /**
     * Handles the "Add/Update Parcel" button click.
     * (Keep the function definition from the previous full code block here)
     */
    function handleAddUpdateParcel() {
        console.log("[FORM ACTION] 'Add/Update Parcel' button clicked.");
        uploadStatus.textContent = ''; // Clear previous status
        let isValid = true;

        // --- 1. Collect Basic Parcel Data ---
        const parcelData = {
            id: formElements.id ? formElements.id.value.trim() : '',
            kmlId: formElements.kmlId ? formElements.kmlId.value.trim() : '',
            name: formElements.name ? formElements.name.value.trim() : '',
            location: formElements.location ? formElements.location.value.trim() : '',
            csvAvailable: formElements.csvAvailable ? formElements.csvAvailable.checked : false, // Add check
            gridBaseUrl: formElements.gridBaseUrl ? formElements.gridBaseUrl.value.trim() || undefined : undefined, // Add check
            layers: {}
        };
        console.log("[ADD/UPDATE] Collected basic data:", parcelData);

        // --- 2. Validate Required Fields ---
        if (!parcelData.id || !parcelData.kmlId || !parcelData.name || !parcelData.location) {
            uploadStatus.textContent = 'Error: Fields marked with * (ID, KML ID, Name, Location) are required.';
            uploadStatus.style.color = 'red';
            isValid = false;
            // Highlight fields (add checks for existence)
            if (formElements.id) { if (!parcelData.id) formElements.id.style.borderColor = 'red'; else formElements.id.style.borderColor = ''; }
            if (formElements.kmlId) { if (!parcelData.kmlId) formElements.kmlId.style.borderColor = 'red'; else formElements.kmlId.style.borderColor = ''; }
            if (formElements.name) { if (!parcelData.name) formElements.name.style.borderColor = 'red'; else formElements.name.style.borderColor = ''; }
            if (formElements.location) { if (!parcelData.location) formElements.location.style.borderColor = 'red'; else formElements.location.style.borderColor = ''; }
            console.error("[ADD/UPDATE] Validation Error: Required fields missing.");
            return;
        } else {
             // Clear borders if valid (add checks)
             if (formElements.id) formElements.id.style.borderColor = '';
             if (formElements.kmlId) formElements.kmlId.style.borderColor = '';
             if (formElements.name) formElements.name.style.borderColor = '';
             if (formElements.location) formElements.location.style.borderColor = '';
        }

        // --- 3. Collect and Validate Layer Data ---
        const layerRows = newLayersContainer.querySelectorAll('.layer-input-row');
        const datePattern = /^\d{2}-\d{2}-\d{4}$/; // DD-MM-YYYY format
        const collectedDates = new Set();
        let layerCount = 0;
        console.log(`[ADD/UPDATE] Processing ${layerRows.length} layer rows.`);

        layerRows.forEach((row, index) => {
            // ... (Keep the layer validation logic exactly as in the previous version) ...
             if (!isValid) return;
            const dateInput = row.querySelector('.newLayerDate');
            const rgbInput = row.querySelector('.newLayerRgbUrl');
            const ndviInput = row.querySelector('.newLayerNdviUrl');
            const date = dateInput.value.trim();
            const rgbUrl = rgbInput.value.trim();
            const ndviUrl = ndviInput.value.trim();
            dateInput.style.borderColor = ''; rgbInput.style.borderColor = ''; ndviInput.style.borderColor = '';

            if (date && rgbUrl) {
                layerCount++;
                // console.log(`[ADD/UPDATE] Processing Layer Row ${index + 1}: Date=${date}, RGB=${rgbUrl}, NDVI=${ndviUrl || 'N/A'}`); // Uncomment if needed
                if (!datePattern.test(date)) {
                     uploadStatus.textContent = `Error: Invalid date format in layer row ${index + 1}. Use DD-MM-YYYY.`; dateInput.style.borderColor = 'red'; isValid = false; return;
                }
                if (collectedDates.has(date)) {
                     uploadStatus.textContent = `Error: Duplicate date "${date}" found in layer row ${index + 1}. Dates must be unique.`; dateInput.style.borderColor = 'red'; isValid = false; return;
                }
                if (!rgbUrl.includes('{z}') || !rgbUrl.includes('{x}') || !rgbUrl.includes('{y}')) {
                     uploadStatus.textContent = `Error: Invalid RGB URL in layer row ${index + 1}. Must include {x}, {y}, {z}.`; rgbInput.style.borderColor = 'red'; isValid = false; return;
                }
                parcelData.layers[date] = rgbUrl; collectedDates.add(date);
                if (ndviUrl) {
                    if (!ndviUrl.includes('{z}') || !ndviUrl.includes('{x}') || !ndviUrl.includes('{y}')) {
                         uploadStatus.textContent = `Error: Invalid NDVI URL in layer row ${index + 1}. Must include {x}, {y}, {z}.`; ndviInput.style.borderColor = 'red'; isValid = false; return;
                     }
                     parcelData.layers[`${date}-NDVI`] = ndviUrl;
                }
            } else if (date || rgbUrl || ndviUrl) {
                 uploadStatus.textContent = `Error: Incomplete layer definition in row ${index + 1}. Date and RGB URL are required.`;
                 if (!date) dateInput.style.borderColor = 'red';
                 if (!rgbUrl) rgbInput.style.borderColor = 'red';
                 isValid = false; return;
            }
        });

        if (!isValid) {
            uploadStatus.style.color = 'red';
            console.error("[ADD/UPDATE] Validation Error: Layer data invalid.");
            return;
        }
        console.log("[ADD/UPDATE] Layer data collected:", parcelData.layers);


        // --- 4. Check for ID and KML ID Uniqueness & Perform Add/Update ---
        const isEditing = formElements.id ? formElements.id.readOnly : false; // Check if element exists
        const existingParcelIndex = allParcelsData.findIndex(p => p.id === parcelData.id);
        const kmlIdExistsIndex = allParcelsData.findIndex(p => String(p.kmlId).trim() === String(parcelData.kmlId).trim());
        console.log(`[ADD/UPDATE] isEditing=${isEditing}, existingParcelIndex=${existingParcelIndex}, kmlIdExistsIndex=${kmlIdExistsIndex}`);

        let successMessage = ''; // Store success message

        if (isEditing) { // --- UPDATE ---
             console.log(`[ADD/UPDATE] Mode: Updating parcel ID: ${parcelData.id}`);
            if (existingParcelIndex === -1) {
                 console.error(`[ADD/UPDATE] Error: Cannot update - Original parcel ID ${parcelData.id} not found.`);
                 uploadStatus.textContent = `Error: Cannot update - Original parcel ID ${parcelData.id} not found.`; uploadStatus.style.color = 'red'; return;
            }
            if (kmlIdExistsIndex > -1 && kmlIdExistsIndex !== existingParcelIndex) {
                 uploadStatus.textContent = `Error: KML ID "${parcelData.kmlId}" is already used by another parcel (ID: ${allParcelsData[kmlIdExistsIndex].id}). KML IDs must be unique.`;
                 if(formElements.kmlId) formElements.kmlId.style.borderColor = 'red';
                 uploadStatus.style.color = 'red'; return;
            }
            allParcelsData[existingParcelIndex] = parcelData;
            successMessage = `Success: Parcel "${parcelData.name}" (ID: ${parcelData.id}) updated.`; // Store message
            dataHasChanged = true;
            if (currentParcel && currentParcel.id === parcelData.id) {
                 console.log("[ADD/UPDATE] Refreshing currently selected parcel view after update.");
                currentParcel = parcelData;
                availableDates = Object.keys(currentParcel.layers).filter(key => !key.endsWith("-NDVI")).sort(/* sort */(a, b) => { const [dayA, monthA, yearA] = a.split('-').map(Number); const [dayB, monthB, yearB] = b.split('-').map(Number); return new Date(yearA, monthA - 1, dayA) - new Date(yearB, monthB - 1, dayB); });
                setupSlider();
                updateTileLayer();
            }
        } else { // --- ADD ---
             console.log(`[ADD/UPDATE] Mode: Adding new parcel ID: ${parcelData.id}`);
            if (existingParcelIndex > -1) {
                 uploadStatus.textContent = `Error: Parcel ID "${parcelData.id}" already exists. Use the Edit button or choose a unique ID.`;
                 if(formElements.id) formElements.id.style.borderColor = 'red';
                 uploadStatus.style.color = 'red'; return;
            }
            if (kmlIdExistsIndex > -1) {
                 uploadStatus.textContent = `Error: KML ID "${parcelData.kmlId}" is already used by parcel ID: ${allParcelsData[kmlIdExistsIndex].id}. KML IDs must be unique.`;
                 if(formElements.kmlId) formElements.kmlId.style.borderColor = 'red';
                 uploadStatus.style.color = 'red'; return;
            }
            allParcelsData.push(parcelData);
            allParcelsData.sort((a, b) => (a.location + a.name).localeCompare(b.location + b.name));
            successMessage = `Success: Parcel "${parcelData.name}" (ID: ${parcelData.id}) added.`; // Store message
            dataHasChanged = true;
            initializeLayerControl(); // Rebuild control as new location might exist
        }

        // --- 5. Post-Save Actions ---
        // Don't disable export button here if we are exporting immediately
        clearAddParcelForm(false);
        addParcelSection.style.display = 'none';
        console.log("[ADD/UPDATE] Parcel added/updated successfully in memory.");

        // --- 6. Refresh KML style ---
        const villageToRefresh = parcelData.location;
        if (kmlLayers[villageToRefresh] && map.hasLayer(kmlLayers[villageToRefresh])) {
            // ... (Keep the KML refresh logic exactly as in the previous version) ...
             console.log(`[ADD/UPDATE] Refreshing KML style in village: ${villageToRefresh} for KML ID: ${parcelData.kmlId}`);
            kmlLayers[villageToRefresh].eachLayer(l => {
                if (l.feature?.properties?.PARCEL_NR && String(l.feature.properties.PARCEL_NR).trim() === String(parcelData.kmlId).trim()) {
                    const hasDataAndLayers = parcelData.layers && Object.keys(parcelData.layers).length > 0;
                    if (l.setStyle) {
                        l.setStyle({ color: hasDataAndLayers ? 'blue' : 'red' });
                         // console.log(`   Updated style for KML ID ${parcelData.kmlId} to ${hasDataAndLayers ? 'blue' : 'red'}.`); // Uncomment if needed
                    }
                     try {
                         const props = l.feature.properties;
                         const updatedParcelData = findParcelByKmlId(props.PARCEL_NR); // Get the latest data again
                         let newPopupContent = `<b>PARCEL_NR (KML ID):</b> ${props.PARCEL_NR}<br>`;
                         if (updatedParcelData) {
                             newPopupContent += `<b>Name:</b> ${updatedParcelData.name || '(N/A)'}<br>`;
                             newPopupContent += `<b>Location:</b> ${updatedParcelData.location || '(N/A)'}<br>`;
                         } else {
                              newPopupContent += `<i style='color:red;'>(No matching data found in JSON)</i><br>`;
                         }
                         newPopupContent += `<b>FARM_ID:</b> ${props.FARM_ID || 'N/A'}<br>`;
                         newPopupContent += `<b>Crop 2024:</b> ${props.CROP_NAME2024 || 'N/A'}<br>`;
                         newPopupContent += `<b>Crop 2025:</b> ${props.CROP_NAME2025 || 'N/A'}<br>`;
                         newPopupContent += `<b>Area (dec.):</b> ${props.AREA_DEC || 'N/A'}<br>`;
                         newPopupContent += `<button type="button" class="edit-parcel-btn" data-kmlid="${props.PARCEL_NR}">Edit/Add Parcel Data</button>`;
                         l.bindPopup(newPopupContent);
                         // console.log(`   Re-bound popup for KML ID ${props.PARCEL_NR}.`); // Uncomment if needed
                     } catch(popupError) {
                         console.error(`[ADD/UPDATE] Error trying to re-bind popup for KML ID ${parcelData.kmlId}:`, popupError);
                     }
                }
            });
        } else {
             console.log(`[ADD/UPDATE] KML layer for village ${villageToRefresh} not loaded, style/popup refresh skipped.`);
        }

        // --- 7. Trigger Download ---
        console.log("[ADD/UPDATE] Attempting to trigger JSON download immediately.");
        // Set status message *before* calling export, as export might reset it
        uploadStatus.textContent = successMessage + " Exporting JSON file...";
        uploadStatus.style.color = 'green';

        // Call the export function directly
        handleExportData(true); // Pass flag to skip confirmation

    } // End handleAddUpdateParcel

    /**
     * Handles the "Export Data" button click OR direct call from add/update.
     * Converts the `allParcelsData` array to a JSON string and triggers a download.
     * @param {boolean} [skipConfirmation=false] - If true, skips the "No changes" confirmation.
     */
    function handleExportData(skipConfirmation = false) {
        console.log(`[FORM ACTION] 'Export Data' executing. skipConfirmation=${skipConfirmation}`);

       // Skip confirmation if called directly after add/update OR if data actually changed
       if (!skipConfirmation && !dataHasChanged && !confirm("No changes have been detected since the last export or page load. Export the current data anyway?")) {
            console.log("[EXPORT] Export cancelled by user confirmation.");
           return;
       }

       if (allParcelsData.length === 0) {
           console.warn("[EXPORT] Parcel data array is empty. Nothing to export.");
           alert("Cannot export: No parcel data available.");
           return;
       }

       try {
           const jsonString = JSON.stringify(allParcelsData, null, 2);
           const blob = new Blob([jsonString], { type: 'application/json' });
           const url = URL.createObjectURL(blob);
           const a = document.createElement('a');
           a.href = url;
           a.download = 'parcels_data_updated.json';
           document.body.appendChild(a);
           a.click();
           document.body.removeChild(a);
           URL.revokeObjectURL(url);

           console.log("[EXPORT] Parcel data exported successfully via download.");
           // Don't overwrite the success message if called from handleAddUpdateParcel
           if (!skipConfirmation) {
               uploadStatus.textContent = 'Export successful! Replace the old parcels_data.json file with the downloaded one.';
               uploadStatus.style.color = 'blue';
           }
           dataHasChanged = false; // Reset the changed flag
           exportDataBtn.disabled = true; // Disable button until next change

       } catch (error) {
           console.error("[EXPORT] Error exporting JSON data:", error);
           uploadStatus.textContent = 'Error during export. Check console for details.';
           uploadStatus.style.color = 'red';
           alert("An error occurred while trying to export the data. See the console for details.");
       }
   } // End handleExportData

    // --- Initialize with one empty layer row ---
    addLayerInputRow(); // Add the initial empty row after all functions are defined

    console.log("[FORM SETUP] 'Manage Parcels' form setup complete.");
} // End setupAddParcelForm

// =====================================================================
// REST OF THE CODE (Keep all other functions as they were in the previous full code block)
// - initializeApp
// - loadParcelData, loadCsvData
// - findParcelByKmlId, normalizeNDVI, disable/enableMapScrollZoom
// - loadKmlLayer, setupKmlFeature
// - handleOverlayAdd, handleOverlayRemove, initializeLayerControl
// - clearParcelSelection, setupSlider, updateTileLayer, updateNdviValuesDisplay
// - removeGrid, displayGridOnCheckbox
// - searchLocation
// - handlePlayButtonClick
// =====================================================================

// Make sure to include all the other functions (initializeApp, etc.) from
// the previous full code listing here. I'm only showing the revised
// setupAddParcelForm section for brevity.

// =====================================================================
// APPLICATION INITIALIZATION
// =====================================================================

/**
 * Main initialization function for the application.
 * Loads data, sets up UI components, and attaches event listeners.
 */
async function initializeApp() {
    console.log("========================================");
    console.log("Initializing Parcel Viewer Application...");
    console.log("========================================");

    // --- 1. Load Core Parcel Data (Essential) ---
    const parcelDataLoaded = await loadParcelData();
    if (!parcelDataLoaded) {
        // Error handling is done within loadParcelData (alert shown)
        console.error("Application initialization failed: Could not load essential parcel data.");
        // Optionally disable UI elements further?
        return; // Stop initialization
    }

    // --- 2. Load Ancillary Data (NDVI Stats - Non-essential) ---
    // Run concurrently, don't wait for it to finish UI setup
    loadCsvData(() => {
        console.log("NDVI CSV data loading process completed (check logs for success/failure).");
        // If a parcel is already selected when CSV loads, update its display
        if (currentParcel) {
            updateNdviValuesDisplay();
        }
    });

    // --- 3. Initialize Map Components ---
    // Tile layers are created on demand now, no pre-creation needed here.
    initializeLayerControl(); // Set up the layer control based on loaded parcel locations

    // --- 4. Setup UI Interactions ---
    setupAddParcelForm(); // Initialize the form for managing parcels

    // --- 5. Attach Event Listeners for Controls ---
    console.log("Setting up UI Event Listeners...");
    ndviCheckbox.addEventListener("change", updateTileLayer); // Update layer (which also updates NDVI values)
    popupCheckbox.addEventListener("change", displayGridOnCheckbox); // Show/hide grid overlay

    // Slider events: 'input' for label update, 'change' for triggering layer load
    timeSlider.addEventListener("input", () => {
        if (currentParcel && availableDates.length > 0) {
            const index = parseInt(timeSlider.value);
            if (index >= 0 && index < availableDates.length) {
                dateLabel.textContent = availableDates[index];
            }
        }
    });
    timeSlider.addEventListener("change", updateTileLayer); // Load new tiles when slider stops moving

    playButton.addEventListener("click", handlePlayButtonClick);
    searchButton.addEventListener("click", searchLocation);
    searchInput.addEventListener("keypress", function(e) {
        if (e.key === 'Enter') {
            searchLocation(); // Trigger search on Enter key
        }
    });

    // --- 6. Set Initial Map State ---
    clearParcelSelection(); // Ensure a clean state (no parcel selected initially)

    console.log("----------------------------------------");
    console.log("Application Initialized Successfully.");
    console.log("Select a location from the layer control to view parcels.");
    console.log("----------------------------------------");
}

// =====================================================================
// START APPLICATION when the DOM is ready
// =====================================================================
document.addEventListener('DOMContentLoaded', initializeApp);