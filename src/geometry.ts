// Geometry utilities for PostGIS ↔ GeoJSON conversion
// Implements EWKB (Extended Well-Known Binary) → GeoJSON parser
// No external dependencies — WKB/EWKB is a stable OGC standard

"use strict";

// ─── GeoJSON detection ───────────────────────────────────────────

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

// ─── EWKB → GeoJSON parser ──────────────────────────────────────

// WKB geometry type IDs (lower 3 bytes, without flags)
const WKB_POINT = 1;
const WKB_LINESTRING = 2;
const WKB_POLYGON = 3;
const WKB_MULTIPOINT = 4;
const WKB_MULTILINESTRING = 5;
const WKB_MULTIPOLYGON = 6;
const WKB_GEOMETRYCOLLECTION = 7;

// EWKB flags (in the type's upper bytes)
const EWKB_FLAG_Z = 0x80000000;
const EWKB_FLAG_M = 0x40000000;
const EWKB_FLAG_SRID = 0x20000000;

// WKB 2000+ offset for ISO Z/M types
const WKB_Z_OFFSET = 1000;
const WKB_M_OFFSET = 2000;
const WKB_ZM_OFFSET = 3000;

interface ParseState {
    buf: Buffer;
    offset: number;
}

function readUInt8(state: ParseState): number {
    const val = state.buf.readUInt8(state.offset);
    state.offset += 1;
    return val;
}

function readUInt32(state: ParseState, le: boolean): number {
    const val = le ? state.buf.readUInt32LE(state.offset) : state.buf.readUInt32BE(state.offset);
    state.offset += 4;
    return val;
}

function readFloat64(state: ParseState, le: boolean): number {
    const val = le ? state.buf.readDoubleLE(state.offset) : state.buf.readDoubleBE(state.offset);
    state.offset += 8;
    return val;
}

function readCoordinate(state: ParseState, le: boolean, hasZ: boolean, hasM: boolean): number[] {
    const x = readFloat64(state, le);
    const y = readFloat64(state, le);
    const coord = [x, y];

    if (hasZ) {
        coord.push(readFloat64(state, le));
    }
    if (hasM) {
        // M coordinate — read but don't include in GeoJSON (not supported)
        readFloat64(state, le);
    }

    return coord;
}

function readCoordinateArray(state: ParseState, le: boolean, hasZ: boolean, hasM: boolean): number[][] {
    const count = readUInt32(state, le);
    const coords: number[][] = [];
    for (let i = 0; i < count; i++) {
        coords.push(readCoordinate(state, le, hasZ, hasM));
    }
    return coords;
}

function readRingArray(state: ParseState, le: boolean, hasZ: boolean, hasM: boolean): number[][][] {
    const ringCount = readUInt32(state, le);
    const rings: number[][][] = [];
    for (let i = 0; i < ringCount; i++) {
        rings.push(readCoordinateArray(state, le, hasZ, hasM));
    }
    return rings;
}

function parseGeometryBody(state: ParseState): any {
    const byteOrder = readUInt8(state);
    const le = byteOrder === 1;

    let rawType = readUInt32(state, le);

    // Detect EWKB flags
    let hasZ = (rawType & EWKB_FLAG_Z) !== 0;
    let hasM = (rawType & EWKB_FLAG_M) !== 0;
    const hasSrid = (rawType & EWKB_FLAG_SRID) !== 0;

    // Strip EWKB flags to get the base type
    let baseType = rawType & 0x1FFFFFFF;

    // Handle ISO WKB type offsets (e.g., 1001 = PointZ, 2001 = PointM, 3001 = PointZM)
    if (baseType >= WKB_ZM_OFFSET) {
        baseType -= WKB_ZM_OFFSET;
        hasZ = true;
        hasM = true;
    } else if (baseType >= WKB_M_OFFSET) {
        baseType -= WKB_M_OFFSET;
        hasM = true;
    } else if (baseType >= WKB_Z_OFFSET) {
        baseType -= WKB_Z_OFFSET;
        hasZ = true;
    }

    // Skip SRID if present (4 bytes)
    if (hasSrid) {
        state.offset += 4;
    }

    switch (baseType) {
    case WKB_POINT: {
        const coord = readCoordinate(state, le, hasZ, hasM);
        return { type: "Point", coordinates: coord };
    }
    case WKB_LINESTRING: {
        const coords = readCoordinateArray(state, le, hasZ, hasM);
        return { type: "LineString", coordinates: coords };
    }
    case WKB_POLYGON: {
        const rings = readRingArray(state, le, hasZ, hasM);
        return { type: "Polygon", coordinates: rings };
    }
    case WKB_MULTIPOINT: {
        const count = readUInt32(state, le);
        const points: number[][] = [];
        for (let i = 0; i < count; i++) {
            const geom = parseGeometryBody(state);
            points.push(geom.coordinates);
        }
        return { type: "MultiPoint", coordinates: points };
    }
    case WKB_MULTILINESTRING: {
        const count = readUInt32(state, le);
        const lines: number[][][] = [];
        for (let i = 0; i < count; i++) {
            const geom = parseGeometryBody(state);
            lines.push(geom.coordinates);
        }
        return { type: "MultiLineString", coordinates: lines };
    }
    case WKB_MULTIPOLYGON: {
        const count = readUInt32(state, le);
        const polygons: number[][][][] = [];
        for (let i = 0; i < count; i++) {
            const geom = parseGeometryBody(state);
            polygons.push(geom.coordinates);
        }
        return { type: "MultiPolygon", coordinates: polygons };
    }
    case WKB_GEOMETRYCOLLECTION: {
        const count = readUInt32(state, le);
        const geometries: any[] = [];
        for (let i = 0; i < count; i++) {
            geometries.push(parseGeometryBody(state));
        }
        return { type: "GeometryCollection", geometries: geometries };
    }
    default:
        throw new Error("Unsupported WKB geometry type: " + baseType);
    }
}

/**
 * Parses a WKB/EWKB hex string into a GeoJSON object.
 * Supports all standard geometry types, EWKB SRID flags,
 * and ISO Z/M/ZM type offsets.
 *
 * @param wkbHex WKB hex string from PostGIS
 * @returns GeoJSON geometry object, or the raw string on parse failure
 */
export function wkbToGeoJSON(wkbHex: string): any {
    try {
        const buf = Buffer.from(wkbHex, "hex");
        const state: ParseState = { buf, offset: 0 };
        return parseGeometryBody(state);
    } catch {
        return wkbHex;
    }
}
