// Geometry utilities for PostGIS ↔ GeoJSON conversion

"use strict";

import { Geometry } from "wkx";

/**
 * Valid GeoJSON geometry type names
 */
const GEOJSON_TYPES = new Set([
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
]);

/**
 * Checks if a value is a GeoJSON geometry object
 * @param val The value to check
 * @returns true if the value is a GeoJSON geometry
 */
export function isGeoJSON(val: any): boolean {
    if (typeof val !== "object" || val === null) {
        return false;
    }

    return (
        typeof val.type === "string" &&
        GEOJSON_TYPES.has(val.type) &&
        (Array.isArray(val.coordinates) || Array.isArray(val.geometries))
    );
}

/**
 * Parses a WKB/EWKB hex string into a GeoJSON object.
 * Used by the pg type parser to automatically convert geometry
 * columns returned by PostGIS.
 *
 * @param wkbHex WKB hex string from PostGIS
 * @returns GeoJSON geometry object, or the raw string on parse failure
 */
export function wkbToGeoJSON(wkbHex: string): any {
    try {
        return Geometry.parse(Buffer.from(wkbHex, "hex")).toGeoJSON();
    } catch {
        return wkbHex;
    }
}
