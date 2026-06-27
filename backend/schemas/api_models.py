from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any

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
    first_opening_date: Optional[str]
    lat: Optional[float]
    lon: Optional[float]

class NetworkOriginResponse(BaseModel):
    oldest: Dict[str, Any]
    newest: Dict[str, Any]
    new_this_month: int

class StoreTimelineRange(BaseModel):
    min: int
    max: int

class StoreTimelineMilestones(BaseModel):
    m1000: Optional[int] = Field(None, alias="1000")
    m2000: Optional[int] = Field(None, alias="2000")
    m5000: Optional[int] = Field(None, alias="5000")
    m10000: Optional[int] = Field(None, alias="10000")

    model_config = ConfigDict(populate_by_name=True)

class StoreTimelineResponse(BaseModel):
    stores: List[List[Any]]
    undated: List[List[float]]
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
    powiat: str
    voivodeship: str
    avg_salary: float
    unemployment_rate: float
    population: int
    stores: int
    per_1k: float

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
    rows: List[InPostVsZabkaByLevelResponseItem]
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
    p5: Optional[int]
    p95: Optional[int]

class ElevationHistogramItem(BaseModel):
    bucket_m: int
    cnt: int

class ElevationResponse(BaseModel):
    extremes: List[ElevationExtremeItem]
    histogram: List[ElevationHistogramItem]
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
    buckets: List[NeighborBucket]

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
    rows: List[NeighborByLevelItem]
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
    closest_pairs: List[Dict[str, Any]]
    same_address: List[SameAddressItem]
    points: List[TwinPoint]
    points_50: List[TwinPoint]

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
    facts: List[KraniecFactItem]
    backdrop: List[List[float]]

# --- Ecology / Amphibians Schemas ---

class FarthestFromFrog(BaseModel):
    city: Optional[str]
    voivodeship: Optional[str]
    nearest_amphibian_km: Optional[float]
    latitude: Optional[float]
    longitude: Optional[float]

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
    gbif_total: Optional[int]
    median_occurrences: Optional[int]
    has_enriched_data: bool
    most_froggy: MostFroggy
    zero_frog_count: Optional[int]
    farthest_from_frog: FarthestFromFrog
    voivodeship_names: List[str]
    stores: List[List[Any]]
    scatter_sample: List[List[int]]
    distribution: List[AmphibianDistributionItem]
    by_voivodeship: List[AmphibianByVoivodeshipItem]
    top10: List[AmphibianTop10Item]
    gbif_obs: List[Any]

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
    top3: List[ParkTop3Item]

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
    h24_cities: List[H24CityItem]
    h24_points: List[List[float]]
    parks: Section3Parks
    void: Section3Void
    frog_streets: List[FrogStreetItem]
    frog_streets_count: int
    west_wall_points: List[List[float]]
    powiats_covered: int
    powiat_range: List[PowiatRangeItem]
    civic_streets: CivicStreets
    physical_streets: List[PhysicalStreetItem]

# --- Geo / Coverage Schemas ---

class PowiatCoverageResponse(BaseModel):
    total: int
    covered: int
    dots: List[List[float]]

class ByDimensionItem(BaseModel):
    name: str
    cnt: int
    population: Optional[int]
    area_km2: Optional[float]
    per_1k: Optional[float]
    per_km2: Optional[float]
    lat: Optional[float]
    lon: Optional[float]
    voivodeship: str
    geo_id: Optional[str]

class ByDimensionResponse(BaseModel):
    rows: List[ByDimensionItem]
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
    with_val: int = Field(alias="with")
    total: int
    pct: float

    model_config = ConfigDict(populate_by_name=True)

class GminaLeadersItem(BaseModel):
    name: str
    voivodeship: str
    cnt: int
    population: Optional[int]
    area_km2: Optional[float]
    per_1k: Optional[float]
    per_km2: Optional[float]

class GminaLeadersResponse(BaseModel):
    per_1k: List[GminaLeadersItem]
    per_km2: List[GminaLeadersItem]
    national_per_1k: Optional[float]

# --- Legacy/Stats Router Duplications ---

class TopStreetItem(BaseModel):
    street: str
    city: str
    count: int

class TopStreetsResponse(BaseModel):
    data: List[TopStreetItem]

class GrowthTrendItem(BaseModel):
    date: str
    count: int

class GrowthTrendResponse(BaseModel):
    data: List[GrowthTrendItem]

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
    streets: List[CommonStreetItem]
    distinct: int

