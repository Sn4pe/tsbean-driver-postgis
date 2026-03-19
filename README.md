# TSBean-ORM PostGIS Driver

PostGIS driver for [tsbean-orm](https://github.com/AgustinSRG/tsbean-orm). Fork of [tsbean-driver-postgres](https://github.com/AgustinSRG/tsbean-driver-postgres) with automatic geometry handling.

Drop-in replacement that adds:

- **Reads**: automatic WKB/EWKB → GeoJSON conversion (built-in parser, zero dependencies)
- **Writes**: automatic GeoJSON → `ST_GeomFromGeoJSON()` wrapping
- **Filters**: spatial query support (`ST_Intersects`, `ST_Contains`, `ST_Within`, `ST_DWithin`)

## Installation

```
npm install --save tsbean-driver-postgis
```

**Requirements**: PostgreSQL with the [PostGIS](https://postgis.net/) extension enabled.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

## Usage

```ts
import { DataSource } from "tsbean-orm";
import { PostGISDriver } from "tsbean-driver-postgis";

const mySource = PostGISDriver.createDataSource({
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "postgres",
    database: "my_database",
});

DataSource.set(DataSource.DEFAULT, mySource);
```

## Geometry columns

Define geometry columns in your table using the PostGIS `GEOMETRY` type:

```sql
CREATE TABLE "locations" (
    "id" VARCHAR NOT NULL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "geometry" GEOMETRY(Geometry, 4326)
);

CREATE INDEX "ix_locations_spatial" ON "locations" USING GIST ("geometry");
```

In your model, use the geometry field as a plain GeoJSON object. The driver handles all conversions transparently:

```ts
export class Location extends DataModel {

    public static finder = new DataFinder<Location>(
        DataSource.DEFAULT, "locations", "id",
        (data) => new Location(data),
    );

    public id: string;
    public name: string;
    public geometry: any; // GeoJSON object

    constructor(data: TypedRow<Location>) {
        super(DataSource.DEFAULT, "locations", "id");

        this.id = enforceType(data.id, "string");
        this.name = enforceType(data.name, "string");
        this.geometry = data.geometry || null; // Already parsed as GeoJSON by the driver

        this.init();
    }
}
```

### Insert

```ts
const location = new Location({
    id: "loc-1",
    name: "Forest Plot A",
    geometry: {
        type: "Polygon",
        coordinates: [[[-3.7, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-3.7, 40.5], [-3.7, 40.4]]],
    },
});

await location.insert();
```

The driver detects the GeoJSON object and generates:

```sql
INSERT INTO "locations" ("id", "name", "geometry")
VALUES ($1, $2, ST_GeomFromGeoJSON($3)::geometry)
```

### Read

```ts
const location = await Location.finder.findByKey("loc-1");

console.log(location.geometry);
// { type: "Polygon", coordinates: [[[-3.7, 40.4], ...]] }
```

PostGIS returns geometry as WKB (binary). The driver automatically parses it to GeoJSON using a built-in EWKB parser — no external dependencies needed.

### Update

```ts
location.geometry = { type: "Point", coordinates: [-3.7, 40.4] };
await location.save();
```

## Supported geometry types

| GeoJSON type | WKB type | 3D (Z) | SRID |
|---|---|---|---|
| Point | Point | Yes | Yes |
| LineString | LineString | Yes | Yes |
| Polygon | Polygon | Yes | Yes |
| MultiPoint | MultiPoint | Yes | Yes |
| MultiLineString | MultiLineString | Yes | Yes |
| MultiPolygon | MultiPolygon | Yes | Yes |
| GeometryCollection | GeometryCollection | Yes | Yes |

## Spatial filters

The driver extends tsbean-orm's filter system with PostGIS spatial operations. These can be used via `customQuery`:

```ts
const driver = DataSource.get(DataSource.DEFAULT).driver as any;

// Find all locations within a bounding box
const result = await driver.customQuery(
    `SELECT * FROM "locations" WHERE ST_Intersects("geometry", ST_GeomFromGeoJSON($1)::geometry)`,
    [JSON.stringify({ type: "Polygon", coordinates: [/* bounding box */] })],
);
```

## Identifier conversion

This driver inherits the identifier mapping from tsbean-driver-postgres. By default, it converts between [camelCase](https://en.wikipedia.org/wiki/Camel_case) (TypeScript) and [snake_case](https://en.wikipedia.org/wiki/Snake_case) (PostgreSQL).

For example, `projectId` in your model maps to `project_id` in the database.

To disable this:

```ts
const mySource = PostGISDriver.createDataSource({
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "postgres",
    database: "my_database",
    disableIdentifierConversion: true,
});
```

You can also set `customIdentifierConversion` to implement your own mapping.

## How it works

```
┌─────────────────────────┐
│     Application         │
│   (GeoJSON objects)     │
└────────┬────────────────┘
         │
    ┌────▼────┐
    │  Write  │  Detects GeoJSON → ST_GeomFromGeoJSON($N)::geometry
    │  Read   │  Registers pg type parser → EWKB hex → GeoJSON
    └────┬────┘
         │
┌────────▼────────────────┐
│   PostgreSQL + PostGIS  │
│   (WKB binary + GIST)   │
└─────────────────────────┘
```

- **Writes**: `toSQLCompatibleValue()` checks if a value is a GeoJSON geometry object. If so, it serializes it as JSON and uses `ST_GeomFromGeoJSON(?)::geometry` as the SQL placeholder instead of `?`.
- **Reads**: On first query, the driver looks up the OID of the `geometry` type in `pg_type` and registers a `pg.types.setTypeParser` that converts WKB hex to GeoJSON using a built-in EWKB parser.
- **No external dependencies** for geometry handling — the EWKB parser is ~170 lines of pure `Buffer.read*` operations.

## License

MIT
