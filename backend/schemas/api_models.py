from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# --- Shared & Base Schemas ---

class SummaryResponse(BaseModel):
    total_active: int
    cities_count: int
    merrychef_pct: float
    sunday_pct: float
    h24_count: int

class NetworkGrowthItem(BaseModel):
    year: int
    new_stores: int
    cumulative: int

class StoreOriginItem(BaseModel):
    city: str
    voivodeship: str
    street: str
    first_opening_date: str | None
    lat: float | None
    lon: float | None

class NetworkOriginResponse(BaseModel):
    oldest: dict[str, Any]
    newest: dict[str, Any]
    new_this_month: int

class StoreTimelineRange(BaseModel):
    min: int
    max: int

class StoreTimelineMilestones(BaseModel):
    m1000: int | None = Field(None, alias="1000")
    m2000: int | None = Field(None, alias="2000")
    m5000: int | None = Field(None, alias="5000")
    m10000: int | None = Field(None, alias="10000")

    model_config = ConfigDict(populate_by_name=True)

class StoreTimelineResponse(BaseModel):
    stores: list[list[Any]]
    undated: list[list[float]]
    year_range: StoreTimelineRange
    milestones: StoreTimelineMilestones

class GrowthByVoivodeshipResponseItem(BaseModel):
    voivodeship: str
    yr: int
    new_stores: int

class PerCapitaResponseItem(BaseModel):
    voivodeship: str
    stores: int
    population: int
    per_1k: float

class CityFirstOpeningItem(BaseModel):
    yr: int
    new_cities: int
    cumulative_cities: int

class TopCityItem(BaseModel):
    city: str
    cnt: int
    voivodeship: str

class OpeningSeasonalityResponseItem(BaseModel):
    month: int
    label: str
    cnt: int

class OpeningHoursPatternItem(BaseModel):
    pattern: str
    cnt: int

class VoivodeshipStatsResponseItem(BaseModel):
    voivodeship: str
    total: int
    mc_count: int
    mc_pct: float

class PowiatEconomicsItem(BaseModel):
    powiat_id: int
    powiat: str
    voivodeship: str
    avg_salary: float
    unemployment_rate: float
    population: int
    stores: int
    per_1k: float
    lon: float | None = None
    lat: float | None = None

class SundayByVoivodeshipResponseItem(BaseModel):
    voivodeship: str
    closed_pct: float
    closed_count: int
    total: int

class InPostVsZabkaResponseItem(BaseModel):
    voivodeship: str
    zabki: int
    paczkomaty: int
    population: int
    zabki_per_100k: float
    lockers_per_100k: float
    ratio: float

class InPostVsZabkaByLevelResponseItem(BaseModel):
    name: str
    voivodeship: str
    zabki: int
    paczkomaty: int
    population: int
    zabki_per_100k: float
    lockers_per_100k: float
    ratio: float

class InPostVsZabkaByLevelResponse(BaseModel):
    rows: list[InPostVsZabkaByLevelResponseItem]
    total: int
    level: str

class VoivodeshipDensityResponseItem(BaseModel):
    voivodeship: str
    stores: int
    area_km2: float

# --- Elevation Schemas ---

class ElevationExtremeItem(BaseModel):
    which: str
    city: str
    voivodeship: str
    street: str
    elevation_meters: float

class ElevationPercentiles(BaseModel):
    p5: int | None
    p95: int | None

class ElevationHistogramItem(BaseModel):
    bucket_m: int
    cnt: int

class ElevationResponse(BaseModel):
    extremes: list[ElevationExtremeItem]
    histogram: list[ElevationHistogramItem]
    percentiles: ElevationPercentiles

# --- Neighbor Schemas ---

class LonerStore(BaseModel):
    city: str
    voivodeship: str
    street: str
    nearest_neighbor_distance_meters: int

class NeighborBucket(BaseModel):
    bucket: str
    cnt: int

class NeighborDistribution(BaseModel):
    median_m: float
    avg_m: float
    max_m: float
    buckets: list[NeighborBucket]

class NeighborStatsResponse(BaseModel):
    loner: LonerStore
    distribution: NeighborDistribution
    zero_distance_count: int

class NeighborByLevelItem(BaseModel):
    name: str
    voivodeship: str
    n: int
    median_m: int
    avg_m: int

class NeighborByLevelResponse(BaseModel):
    rows: list[NeighborByLevelItem]
    total: int
    level: str
    metric: str

# --- Twins Schemas ---

class SameAddressItem(BaseModel):
    city: str
    street: str
    n: int

class TwinPoint(BaseModel):
    lat: float
    lon: float
    distance_m: int
    city: str
    street: str
    bucket: str

class TwinsResponse(BaseModel):
    within_50m: int
    within_100m: int
    within_200m: int
    total: int
    closest_pairs: list[dict[str, Any]]
    same_address: list[SameAddressItem]
    points: list[TwinPoint]
    points_50: list[TwinPoint]

# --- Kraniec Facts Schemas ---

class KraniecFactItem(BaseModel):
    id: str
    group: str
    label: str
    value: str
    city: str
    voivodeship: str
    street: str
    lat: float
    lon: float
    zoom: int
    type: str

class KraniecFactsResponse(BaseModel):
    facts: list[KraniecFactItem]
    backdrop: list[list[float]]

# --- Ecology / Amphibians Schemas ---

class FarthestFromFrog(BaseModel):
    city: str | None
    voivodeship: str | None
    nearest_amphibian_km: float | None
    latitude: float | None
    longitude: float | None

class MostFroggy(BaseModel):
    city: str
    voivodeship: str
    street: str
    amphibian_occurrences_5km: int
    nearest_amphibian_km: float
    latitude: float
    longitude: float

class AmphibianDistributionItem(BaseModel):
    bucket: str
    cnt: int

class AmphibianByVoivodeshipItem(BaseModel):
    voivodeship: str
    avg_occurrences: int
    stores: int

class AmphibianTop10Item(BaseModel):
    city: str
    voivodeship: str
    occ: int

class AmphibianExtremesResponse(BaseModel):
    gbif_total: int | None
    median_occurrences: int | None
    has_enriched_data: bool
    most_froggy: MostFroggy
    zero_frog_count: int | None
    farthest_from_frog: FarthestFromFrog
    voivodeship_names: list[str]
    stores: list[list[Any]]
    scatter_sample: list[list[int]]
    distribution: list[AmphibianDistributionItem]
    by_voivodeship: list[AmphibianByVoivodeshipItem]
    top10: list[AmphibianTop10Item]
    gbif_obs: list[Any]

class H24CityItem(BaseModel):
    city: str
    voivodeship: str
    cnt: int

class ParkTop3Item(BaseModel):
    park_name: str
    park_type: str
    cnt: int

class Section3Parks(BaseModel):
    count: int
    total: int
    top3: list[ParkTop3Item]

class Section3Void(BaseModel):
    value: float
    lat: float
    lon: float

class FrogStreetItem(BaseModel):
    street: str
    city: str
    voivodeship: str
    latitude: float
    longitude: float

class PowiatRangeItem(BaseModel):
    which: str
    powiat: str
    voivodeship: str
    cnt: int

class CivicStreets(BaseModel):
    rynek: int
    kosciuszki: int
    pilsudskiego: int
    wojska_polskiego: int
    mickiewicza: int
    jana_pawla_ii: int

class PhysicalStreetItem(BaseModel):
    street: str
    city: str
    cnt: int

class Section3RareResponse(BaseModel):
    h24_cities: list[H24CityItem]
    h24_points: list[list[float]]
    parks: Section3Parks
    void: Section3Void
    frog_streets: list[FrogStreetItem]
    frog_streets_count: int
    west_wall_points: list[list[float]]
    powiats_covered: int
    powiat_range: list[PowiatRangeItem]
    civic_streets: CivicStreets
    physical_streets: list[PhysicalStreetItem]

# --- Geo / Coverage Schemas ---

class PowiatCoverageResponse(BaseModel):
    total: int
    covered: int
    dots: list[list[float]]

class ByDimensionItem(BaseModel):
    name: str
    cnt: int
    population: int | None
    area_km2: float | None
    per_1k: float | None
    per_km2: float | None
    lat: float | None
    lon: float | None
    voivodeship: str
    geo_id: str | None

class ByDimensionResponse(BaseModel):
    rows: list[ByDimensionItem]
    total: int
    dim: str
    metric: str
    sort: str
    avg: float
    median: float
    sum: int

class CityCoverageResponse(BaseModel):
    total_cities: int
    with_zabka: int
    without_zabka: int
    pct: float
    zabka_localities: int

class CoverageFunnelItem(BaseModel):
    level: str
    covered: int
    total: int
    pct: float

class GminaLeadersItem(BaseModel):
    name: str
    voivodeship: str
    cnt: int
    population: int | None
    area_km2: float | None
    per_1k: float | None
    per_km2: float | None

class GminaLeadersResponse(BaseModel):
    per_1k: list[GminaLeadersItem]
    per_km2: list[GminaLeadersItem]
    national_per_1k: float | None

# --- Legacy/Stats Router Duplications ---

class TopStreetItem(BaseModel):
    street: str
    city: str
    count: int

class TopStreetsResponse(BaseModel):
    data: list[TopStreetItem]

class GrowthTrendItem(BaseModel):
    date: str
    count: int

class GrowthTrendResponse(BaseModel):
    data: list[GrowthTrendItem]

class SundayClosedStoreItem(BaseModel):
    city: str
    street: str
    has_merrychef: bool

class OpeningsMonthlyItem(BaseModel):
    year: int
    month: int
    cnt: int

class CommonStreetItem(BaseModel):
    name: str
    cnt: int

class CommonStreetsResponse(BaseModel):
    streets: list[CommonStreetItem]
    distinct: int

