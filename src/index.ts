// tsbean-driver-postgis
// PostGIS driver for tsbean-orm with automatic geometry handling

"use strict"

export { PostGISDriver } from "./driver";
export type { PostGISSourceConfiguration } from "./driver";
export { isGeoJSON, wkbToGeoJSON } from "./geometry";
