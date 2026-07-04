// Single source of truth for dashboard translations.
// English is the default language. Emojis are strictly forbidden.

import { M } from './state.js';

export const translations = {
  en: {
    // Navigation / Tabs
    brand_title: "Żabka Collector",
    tab_siec: "Network",
    tab_spoleczenstwo: "Żabka & Poland",
    skip_link: "Skip to content",
    nav_aria: "Main navigation",
    tablist_aria: "Dashboard sections",
    sr_h1: "Żabka Collector - Interactive Atlas of the Store Network in Poland",
    play_animation: "Play animation",



    // Siec Tab - Hero
    hero_eyebrow_siec: "Żabka Atlas - Snapshot",
    hero_eyebrow_siec_snapshot: "Żabka Atlas - Snapshot {date}",
    hero_eyebrow_siec_data: "Żabka Atlas - Data {year}",
    hero_number_label_siec: "active stores in Poland",
    hero_h1_siec: "Żabka is everywhere. We have the hard data.",
    hero_lede_siec: "{{STAT_PCT_SINCE_2023}}% of today's network was established since 2023. Here is how {{STAT_TOTAL_STORES_WORDS}} stores spread across Poland, year by year.",
    data_disclaimer_header: "A quick note",
    data_disclaimer: "This dashboard only covers stores <b>open today</b>. We started tracking openings and closures on <b>June 17, 2026</b> - older data on closed stores simply doesn't exist, so trends before that date only reflect stores that survived to now.",

    // Siec Tab - Stat Strip
    stat_kicker_startup: "Startup",
    stat_sub_startup: "took to open the first <b>1,000</b> stores",
    stat_unit_years: "years",
    stat_kicker_accel: "Acceleration",
    stat_sub_accel: "took for the last <b>5,000</b> - the pace skyrocketed",
    stat_kicker_hoursstd: "Standard hours",
    stat_sub_hoursstd: "of stores run the standard 06:00-23:00 Mon-Sat hours",
    stat_kicker_neighbor: "Nearest Neighbor",
    stat_sub_neighbor: "median distance to the nearest Żabka",
    stat_unit_meters: "m",
    stat_kicker_cities: "Cities with Żabka",
    stat_sub_cities: "of Polish cities have a Żabka",
    stat_kicker_new_month: "New this month",
    stat_sub_new_month: "stores opened in the last month",

    // Expansion Map & Calendar
    map_growth_title: "How the network grew: 1998-{{STAT_DATA_YEAR_MAX}}",
    map_growth_sub: "Each dot is a store, appearing in its opening year. Alongside is the opening calendar month-by-month - the slider drives both.",
    calendar_aria_label: "Calendar of store openings month-by-month, 1998-{{STAT_DATA_YEAR_MAX}}. Darker fields indicate more openings in a given month.",
    slider_year_label: "Year of network expansion",

    // Growth Chart
    chart_growth_title: "When stores that are still active opened",
    chart_growth_sub: "Bars: new stores in a year (left axis). Line: year-over-year change % (right axis).",
    chart_growth_legend_new: "New stores",
    chart_growth_legend_yoy: "YoY change",
    chart_growth_yoy_axis: "YoY change (%)",
    chart_growth_survival_note: "Survival bias: active stores only - closed stores are excluded from the dataset. Early years (1998-2010) are underrepresented. {{STAT_UNDATED_STORES}} stores without opening dates are omitted.",

    // Origins Card
    origin_old_kicker: "Oldest (still active)",
    origin_old_note: "opened",
    origin_old_note_suffix: " - and still on the map",
    origin_new_kicker: "Newest Żabka",
    origin_new_note: "opened",
    origin_new_note_suffix: " - the newest point on the map",

    // Fingerprint Card
    fingerprint_title: "Unrolled Fingerprint - growth rings, N-E-S-W-N direction",
    fingerprint_sub: "The same data unrolled from the polar layout: X-axis is direction (N-E-S-W-N), Y-axis is year. Each ring represents one year, and the bulge indicates the dominant direction of expansion. Hover for details.",
    fingerprint_aria: "Unrolled fingerprint: each horizontal ring is a year 1998-{{STAT_DATA_YEAR_MAX}}, bulge to left/right shows dominant direction. Hover for details.",
    fingerprint_hint_mouse: "Hover over a ring - each horizontal band is one year of expansion.",
    fingerprint_hint_touch: "Touch and drag over a ring - each horizontal band is one year of expansion.",

    // Bridge Cards
    bridge_expansion: "Expansion direction year-by-year is one story. The other is: how many stores and where. {{STAT_LEADER_ABSOLUTE_VOIV}} leads in absolute numbers - but {{STAT_LEADER_PERCAPITA_VOIV}} wins per capita.",
    bridge_econ_text: "The network looks evenly spread. The data tells a different story.",
    bridge_econ: "Wealthier districts have more stores. The West closes on Sundays, while the rest does not. None of these patterns are accidental.",

    // Najwiecej Zabek (Granular)
    gran_title: "Most Żabkas - districts",
    gran_sub: "active stores count",
    gran_dim_woj: "Voivodeship",
    gran_dim_powiat: "Districts",
    gran_dim_city: "Cities",
    gran_metric_count: "Count",
    gran_metric_per1k: "Żabkas/1k residents",
    gran_metric_per_km2: "Żabkas/km²",
    gran_sort_desc: "Largest",
    gran_sort_asc: "Smallest",
    gran_chart_aria: "Ranking of administrative units by number of Żabka stores. Toggles allow choosing level and metric.",
    gran_ref_others: "Others (avg.)",

    // KPI Strip (Atlas krancow)
    edge_kpi_h24: "24/7 Stores",
    edge_kpi_h24_sub: "never closed",
    edge_kpi_h24_tile: "24/7 Stores - show on map",
    edge_kpi_parks: "In Parks",
    edge_kpi_parks_sub: "stores in national parks and reserves",
    edge_kpi_parks_tile: "Stores in national parks - show on map",
    edge_kpi_frogs: "Amphibian Record",
    edge_kpi_frogs_sub: "amphibian sightings near a single Żabka",
    edge_kpi_frogrecord_tile: "Amphibian record - show on map",
    edge_kpi_void: "Bieszczady Void",
    edge_kpi_void_sub: "from the nearest Żabka",
    edge_kpi_void_tile: "Bieszczady void - show on map",
    edge_kpi_oldest: "Oldest Active",
    edge_kpi_oldest_sub: "Swarzędz - active for 28 years",
    edge_kpi_oldest_tile: "Oldest active store - show on map",
    edge_kpi_farthest: "Farthest from Frog",
    edge_kpi_farthest_sub: "to the nearest amphibian sighting",
    edge_kpi_farthestfrog_tile: "Farthest from frog - show on map",
    oldest_active_sub: "{city} - active for {age} years",
    ep_zerofrog_note: "stores ({pct}%) with zero amphibian sightings in 5 km",
    frog_street_note: "Żabka on Green Frog Street - one of {cnt} stores on streets with frog themes.",
    cities_funnel_text: "out of {total} Polish cities have a Żabka",
    tooltip_year: "Year: {year}",
    tooltip_new_stores: "New stores: {count}",
    tooltip_yoy: "YoY change: {pct}",
    load_more_format: "Load more ({current}/{total})",
    gran_word_voivodeship: "voivodeships",
    gran_word_powiat: "districts",
    gran_word_city: "cities",
    gran_metric_per1k_label: "stores per 1,000 residents",
    gran_metric_per_km2_label: "stores per km²",
    gran_title_format_asc: "Fewest Żabkas - {word}",
    gran_title_format_desc: "Most Żabkas - {word}",
    legend_avg: "avg. {val}",
    legend_median: "median {val}",
    suffix_per1k: "stores/1k",
    suffix_per_km2: "stores/km²",
    lead_totals_template: "<b>{total}</b> stores in <b>{powiats}</b> districts. In two chapters, we check if network density follows <b>wealth</b> and <b>employment</b> - and what the numbers really say.",
    resort_sub_per1k: "communes by stores per 1,000 registered residents - sea and mountains beat the rest of the country",
    resort_sub_perkm2: "communes by stores per km² - large cities win here",
    nbl_sub_template: "{metric} distance to the nearest Żabka, by {level}",
    dumbbell_title_template: "Żabka vs InPost - top {length} {label} alphabetically ({total} total)",

    // Atlas krancow map
    atlas_title: "Atlas of Extremes",
    atlas_reset: "Reset to full map",
    map_zoom_hint_mouse: "ctrl + scroll zooms",
    map_zoom_hint_touch: "use two fingers to pan and zoom",

    // Extremes Panels
    ep_frog_panel: "Żabka on Green Frog Street - show on map",
    ep_frog_eyebrow: "Collector's Gem",
    ep_frog_city: "Żabia Wola, Mazowieckie",
    ep_frog_note: "Żabka on Green Frog Street - a perfect marketing coincidence.",
    ep_highest_panel: "Highest altitude store - show on map",
    ep_highest_eyebrow: "Highest Altitude",
    ep_highest_city: "Kościelisko, Małopolskie",
    ep_highest_street: "Nędzy Kubićca 101",
    ep_lowest_panel: "Store below sea level - show on map",
    ep_lowest_eyebrow: "Only one below sea level",
    ep_lowest_city: "Gdańsk (port), Pomorskie",
    ep_lowest_street: "Przełom 12",
    ep_isolated_panel: "Most isolated store - show on map",
    ep_isolated_eyebrow: "Farthest from neighbor",
    ep_isolated_city: "Michałowo, Podlaskie",
    ep_isolated_street: "Białostocka 2",
    ep_zerofrog_panel: "Store without any frogs nearby - show on map",
    ep_zerofrog_eyebrow: "Żabka without any frogs nearby",
    ep_zerofrog_sub: "stores with zero amphibian sightings in 5 km",

    // Coverage Donut
    coverage_title: "Żabka is almost everywhere",
    coverage_sub: "percentage of units with a Żabka - green: covered, red: empty",
    coverage_donut_aria: "Pie chart: percentage of administrative units with at least one Żabka.",
    coverage_map_aria: "Map of Poland: green units have a Żabka, red do not.",
    coverage_suffix_powiat: "districts have a Żabka",
    coverage_suffix_city: "cities have a Żabka",
    coverage_suffix_gmina: "communes have a Żabka",

    // City Gap (cities with zero Żabki)
    citygap_title: "Cities without a Żabka",
    citygap_sub: "{count} of {total} cities ({pct}%) have zero Żabki - sorted by population",
    citygap_empty: "Every city in Poland has at least one Żabka.",
    citygap_pop_unit: " res.",

    // Bubble Chart
    bubble_title: "What makes up the network - cities",
    bubble_sub: "Bubble size represents the number of stores. Drag to pan; Ctrl + scroll to zoom. Small units fall into 'Others'.",

    // Spoleczenstwo Tab - Hero
    hero_eyebrow_spol: "Żabka & Poland - Culture and Nation",
    hero_h1_spol: "Maximum distance to a Żabka in Poland.",
    hero_lede_spol: "In Poland, Żabka feels right at home. In nearly 30 years, it has become a cultural icon of the country. Let's see where else it fits into Polish culture. Or does it rewrite it?",

    // Spoleczenstwo Tab - KPI Strip
    spol_kpi_residents_kicker: "One store per",
    spol_kpi_residents_unit: " people",
    spol_kpi_residents_sub: "residents of Poland",
    spol_kpi_gminy_kicker: "Commune coverage",
    spol_kpi_gminy_sub: "of communes have at least one Żabka",
    spol_kpi_density_kicker: "Density outlier",
    spol_kpi_density_sub_tpl: "{name}: the densest network in the country",
    spol_kpi_gminaleader_kicker: "Per-capita record",
    spol_kpi_gminaleader_sub_tpl: "{name}: most stores per resident in Poland",
    spol_kpi_inpostmax_kicker: "InPost extreme",
    spol_kpi_inpostmax_sub_tpl: "{name}: the most parcel lockers per store",
    spol_kpi_sunday_kicker: "Sunday Wall",
    spol_kpi_sunday_sub_tpl: "{name}: closed on Sundays vs the national average",

    // Żabka vs InPost
    inpost_title: "Żabka vs InPost",
    inpost_sub: "A duel between two giants of Polish public space. Both serve different needs - Żabka is shopping, InPost is parcel pickup - but both compete for the same square meter of the street.",
    legend_Żabka_100k: "Żabka/100k",
    legend_inpost_100k: "InPost/100k",

    // KNN (Density)
    knn_title: "How dense are Żabkas - typical distance to neighbor",
    knn_sub: "median distance to the nearest Żabka, by voivodeship",
    knn_median: "Median",
    knn_mean: "Average",
    knn_rarest: "Rarest",
    knn_densest: "Densest",
    knn_caveat: "The median is robust against single isolated stores; the average is skewed upward by extremes (in Podkarpackie the average is ~1.8 km, while the median is 459 m).",
    knn_half_title: "Half of the network has a neighbor closer than 300 m",
    knn_half_sub: "Distribution of distance to the nearest store (k-NN).",
    knn_stat_max: "max.",

    // Elevation
    ele_title: "From the port in Gdansk to the peak in the Tatras",
    ele_sub: "Distribution of active store elevation above sea level, in 50 m buckets.",
    ele_caveat: "The extremes are single points: a store at the port in Gdansk sits below sea level, while one in Koscielisko under the Tatras sits highest in the whole network. 90% of stores fall between the P5 and P95 lines.",

    // Streets
    streets_title: "Streets with the most Żabkas",
    streets_sub_prefix: "Specific street and city, not just the name - total of ",
    streets_sub_suffix: " stores",

    // Resort Communes
    resort_title: "Most Żabkas per capita? Resorts.",
    resort_sub: "communes by stores per 1,000 registered residents - sea and mountains beat the rest of the country",
    resort_caveat: "Registered population counts residents, but resort towns host many times more people in summer. That is precisely the point: the network follows tourists, not registration records.",

    // Econ maps
    econ_intro_title: "Where there are more Żabkas than economics predict",
    econ_intro_sub: "Two maps of districts. The color shows the deviation from the trend line: how many more (green) or fewer (red) stores per 1,000 residents exist than predicted by a simple correlation with the selected indicator. White districts sit exactly on the trend line. Green indicates a higher density than economics would explain.",
    econ_unemp_title: "Residuals vs Unemployment",
    econ_unemp_sub: "Usually, higher unemployment means a sparser network. Green shows districts that still have more Żabkas than unemployment suggests.",
    econ_salary_title: "Residuals vs Wages",
    econ_salary_sub: "Wealthier districts have a denser network. Green = denser, red = sparser than wages alone would suggest.",
    econ_error_load: "Failed to load data.",
    econ_error_retry: "Try again",

    // Footer
    foot_built_with: "Built with public data",
    foot_methodology: "Methodology",
    foot_portfolio: "Portfolio",
    foot_last_updated: "Data updated",
    foot_disclaimer: "Independent fan/analytics project built on public data. Not affiliated with Żabka Polska or Żabka Group. Trademarks belong to their owners.",

    // Deep links / copy-link (S1)
    copy_link_aria: "Copy link to this section",
    link_copied: "Link copied",
    link_copy_failed: "Couldn't copy the link",

    // Nav link to the dedicated FAQ page (/faq.html - PL-only content, like
    // methodology.html, so just the link label is translated)
    nav_faq_link: "FAQ",

    // PNG export toolbar (S3)
    export_copy_aria: "Copy image to clipboard",
    export_download_aria: "Download as PNG",
    export_copied: "Image copied",
    export_copy_failed: "Couldn't copy the image",
    export_not_ready: "Not loaded yet - try again in a moment",

    stat_unit_meters_km: " km",

    // FAQ Page
    faq_title: "FAQ - Frequently Asked Questions about the Żabka Network and Data",
    faq_meta_desc: "How many Żabka stores are in Poland, where are they located, how far is the nearest - and why correlation on economic maps does not imply causation. Questions and answers with data.",
    faq_h1: "FAQ",
    faq_sub: "Frequently asked questions about the Żabka network - backed by data, not intuition. Plus the questions that *should* be asked when looking at correlation maps, but usually aren't.",
    faq_disclaimer: "Zabkozbior is an independent fan/analytical project based on public data. It is not affiliated with Żabka Polska sp. z o.o. or Żabka Group. The name \"Żabka\" and related trademarks belong to their respective owners.",
    faq_sec_facts: "Basic Network Facts",
    faq_q_count: "How many Żabka stores are in Poland?",
    faq_a_count: "Over {{STAT_TOTAL_STORES_ROUNDED}} active stores across more than {{STAT_CITIES_COUNT_ROUNDED}} cities and towns. This number changes daily - the network opens new locations almost non-stop, although some stores also close along the way (see below).",
    faq_q_most: "Where is the largest number of Żabka stores?",
    faq_a_most: "In absolute numbers: Warsaw (over {{STAT_WARSAW_STORE_COUNT}} stores) and the {{STAT_LEADER_ABSOLUTE_VOIV}} voivodeship as a whole. However, this is primarily an effect of the size of the city and region - a larger population means more stores, without exception. On a per-capita basis, {{STAT_LEADER_PERCAPITA_VOIV}} leads (about {{STAT_LEADER_PERCAPITA_VALUE}} stores per 1,000 residents), not {{STAT_LEADER_ABSOLUTE_VOIV}}. The rankings flip depending on what you divide by - this is no accident, it is the exact same mechanism we describe in the section about mixing absolute numbers with density below.",
    faq_q_farthest: "Where is the point farthest from any Żabka?",
    faq_a_farthest: "The point farthest from any Żabka in Poland is located in the Bieszczady Mountains, about {{STAT_VOID_DISTANCE_KM}} km in a straight line from the nearest store. This is practically the middle of Polonina Wetlinska.",
    faq_q_yearly: "How many Żabka stores are added annually?",
    faq_a_yearly: "Between several hundred and over {{STAT_RECORD_YEAR_OPENINGS}} new stores open each year - {{STAT_RECORD_YEAR}} was a record year with {{STAT_RECORD_YEAR_OPENINGS}} openings. {{STAT_PCT_SINCE_2023}}% of today's active network has been established since 2023. The pace accelerated noticeably after 2020.",
    faq_q_closes: "Does Żabka also close stores, or only open new ones?",
    faq_a_closes: "Yes, it closes them - this is normal rotation for a convenience network, not anything unusual. The issue lies elsewhere: our growth history chart (on the dashboard's Network tab) counts openings only for stores that are active *today*. A store that opened in 2015 and closed in 2022 simply does not exist in this chart - as if it never existed. This makes the early years look weaker than they actually were (see \"survivorship bias\" below). We only started tracking store closures since this project went live - that is a separate, much shorter story.",
    faq_q_every_city: "Is there a Żabka in every town/city in Poland?",
    faq_a_every_city: "No, but it is close - over {{STAT_GMINY_COVERAGE_PCT}}% of communes (gmina) have at least one Żabka, and district coverage is virtually complete ({{STAT_POWIAT_COVERED}} out of {{STAT_POWIAT_TOTAL}} land districts have at least one store). The places without a Żabka are mostly small, scattered rural communes.",
    faq_sec_sources: "Where the Data Comes From",
    faq_q_source_origin: "Where does this data come from?",
    faq_a_source_origin: "The main source is the public store locator JSON file on <code>Żabka.pl</code> - the same one used by the store locator search engine on their website. We enrich it with data from GUS BDL (wages, unemployment, population), GBIF (amphibian observations), InPost ShipX (parcel lockers), and GUGiK (administrative boundaries, geocoding, land elevation). A full description of the sources, the entire ETL pipeline, and the list of known limitations can be found on the <a href=\"/methodology.html\">methodology page</a>.",
    faq_q_update_freq: "How often is the data updated?",
    faq_a_update_freq: "Daily, via an automated pipeline at 3:00 AM Warsaw time. GUS economic data (wages, unemployment, population) is updated less frequently, as GUS itself publishes it once a year.",
    faq_q_download: "Can I download this data myself?",
    faq_a_download: "Yes. The entire DuckDB database (~{{STAT_DB_SIZE_MB}} MB) is available for download from the dashboard under a CC BY 4.0 license. Voivodeship boundaries are available as GeoJSON. The raw API is documented at <code>/docs</code>.",
    faq_q_official: "Is this the official Żabka website?",
    faq_a_official: "No. Zabkozbior is an independent fan/analytical project based on public data, not affiliated with Żabka Polska sp. z o.o. or Żabka Group. The name \"Żabka\" and related trademarks belong to their respective owners.",
    faq_sec_pitfalls: "Common Pitfalls & Misinterpretations",
    faq_pitfalls_note: "This section exists because statistical data is easily bent to support whatever story we want to hear. Below are specific pitfalls that are easy to stumble into when looking at this dashboard - and why conclusions that seem \"obvious at first glance\" are sometimes false.",
    faq_q_econ_correlation: "Does high correlation on economic maps mean that wealth causes more Żabka stores?",
    faq_a_econ_correlation: "No - and this is the single most important pitfall on the entire dashboard. The maps in the \"Żabka & Poland\" section show **correlation**: the deviation of network density from the trend determined by wages or unemployment in a given district. The correlation coefficient r (e.g., r = +{{STAT_R_SALARY}} for wages) describes the strength of this statistical relationship - not a causal mechanism. It could just as easily be the other way around (more stores boosting the local economy), or - most likely - both variables depend on a third factor: population density and urbanization. Wealthier districts are usually also more densely populated and more urbanized, and that is what actually attracts convenience chains - not the mere presence of money.",
    faq_q_amphibians_density: "Does a higher number of amphibian observations in GBIF near a store mean more frogs live there?",
    faq_a_amphibians_density: "Not necessarily. The record holder (over {{STAT_AMPHIBIAN_RECORD_COUNT}} observations within a 5 km radius) is a store in Ursynów, Warsaw - a densely populated district with parks, not a nature reserve. GBIF data consists of citizen science reports: they reflect the density of *observers* with smartphones, not just the density of amphibians. Pristine, sparsely populated areas (Bieszczady, Bialowieza Forest) might have more frogs in reality but fewer reports - simply because fewer people are looking there and uploading observations.",
    faq_q_growth_bias: "Does the network growth chart since 1998 show the full history of openings?",
    faq_a_growth_bias: "No - this is survivorship bias in its purest form. The chart counts openings exclusively for stores that are active *today*. A store that opened in 2003 and closed in 2015 is invisible - as if it never existed. This makes the early years (1998-2010) look weaker than they actually were, because part of that cohort has already dropped out of the data. The curve you see is a \"history of the winners,\" not the complete history of the network.",
    faq_q_saturation_warsaw: "Since Warsaw has the most Żabka stores, does that mean the market is the most saturated there?",
    faq_a_saturation_warsaw: "Not from the absolute count alone. A ranking of absolute numbers is essentially a ranking of city and regional sizes - higher population, more stores, virtually without exception. To assess real saturation, you need to normalize: stores per 1,000 residents or per km². These two rankings look completely different from the absolute ranking (see the GRAN section on the dashboard, with a toggle to switch between metrics) - and that is precisely why this toggle exists.",
    faq_q_sunday_strategy: "Are the differences in Sunday openings between voivodeships a deliberate regional strategy?",
    faq_a_sunday_strategy: "The data only shows the result (the <code>open_sunday</code> flag per store), not the cause. Differences in the percentage of stores closed on Sundays between regions likely reflect local customer traffic patterns and individual decisions at the store level (some stores leverage legal exemptions to the trade ban, e.g., at gas stations or based on a specific revenue structure) - not a centralized policy of \"closing the west but not the east\".",
    faq_q_completeness: "Is this dataset complete and free of missing values?",
    faq_a_completeness: "No. About {{STAT_UNDATED_STORES}} stores lack an opening date in the source. Land elevation is optional (requiring over {{STAT_TOTAL_STORES_ROUNDED}} HTTP queries) and can be NULL. District populations are annual data from GUS, not real-time estimates. A full list of limitations is available on the <a href=\"/methodology.html#czego-nie-gwarantujemy\">methodology page</a>.",
    faq_cta_text: "Want to see this data on maps and charts instead of text?",
    faq_cta_btn: "Open dashboard →",
    faq_foot_back: "Built with public data. <a href=\"/\" class=\"foot-link\">Back to dashboard</a> - <a href=\"/methodology.html\" class=\"foot-link\">Methodology</a>",
    nav_back_dashboard: "Back to dashboard",

    // Methodology Page
    meth_title: "Methodology and Data Sources - Żabka in Numbers",
    meth_meta_desc: "Where the data about the Żabka network comes from: store locator, GUS BDL, GBIF, InPost, and GUGiK. Full methodology, definitions, and known limitations.",
    meth_h1: "Methodology",
    meth_sub: "Where we get the data from, what we do with it, and what we don't know. Sources, limitations, and the entire pipeline step by step.",
    meth_disclaimer: "Zabkozbior is an independent fan/analytical project based on public data. It is not affiliated with Żabka Polska sp. z o.o. or Żabka Group. The name \"Żabka\" and related trademarks belong to their respective owners.",
    meth_sec_sources: "Data Sources",
    meth_source_main_title: "Żabka - main source",
    meth_source_main_desc: "Store locations are sourced from the public JSON file on <code>Żabka.pl</code> - the same file that powers the store search tool on their website. The file contains approximately {{STAT_TOTAL_STORES_ROUNDED}} stores, each with GPS coordinates, address, opening hours, and flags (Merrychef oven, open on Sundays, 24/7). We discard personal data of managers, constant fields (country, activity status), and marketing URLs. Only analytical data remains.",
    meth_source_map_title: "Administrative Division and Mapping",
    meth_source_map_desc: "The structure of Poland's territorial division (three levels: voivodeships, districts/powiaty, and communes/gminy) is built directly from the official GUS BDL and TERYT registers as the first step of the ETL process. Stores and parcel lockers are mapped to this hierarchy relationally based on their locality names, using GUGiK's official Universal Geocoding Service to unambiguously resolve smaller towns and villages, with a spatial match fallback. This eliminates the need for simplified GeoJSON files and slow point-in-polygon checks.",
    meth_source_econ_title: "Economy - GUS BDL",
    meth_source_econ_desc: "Wages, unemployment, and population at the district (powiat) level are sourced from the Local Data Bank (variables 64428, 60270, 72305). We download them once a year. District names must be normalized - GUS likes to add prefixes (<code>Powiat m.</code>), temporal suffixes (<code>since 2023</code>), and rename districts (<code>jeleniogórski</code> became <code>karkonoski</code> in 2021). We clean all of this before matching. Accuracy: the data comes from the year GUS published it, not the current month.",
    meth_source_parks_title: "National and Landscape Parks - GDOŚ",
    meth_source_parks_desc: "The boundaries of national and landscape parks, along with their buffer zones, are downloaded from GDOŚ WFS (layers <code>ParkiNarodowe</code> + <code>ParkiKrajobrazowe</code>). We have {{STAT_PARKS_TOTAL}} objects: {{STAT_PARKS_NATIONAL}} national parks with buffer zones and {{STAT_PARKS_LANDSCAPE}} landscape parks. Every store is checked using point-in-polygon - if it falls within a park or buffer zone, it gets flagged.",
    meth_source_elev_title: "Elevation - GUGiK NMT",
    meth_source_elev_desc: "Elevation above sea level is obtained from GUGiK's Digital Elevation Model (<code>GetHByXY</code>, PL-1992 coordinates). This is opt-in (using the <code>--elevation</code> flag) because it requires over {{STAT_TOTAL_STORES_ROUNDED}} HTTP requests. Results are cached locally (<code>elevation_cache.json</code>) - re-running the ETL does not query points we already have. Note: the GUGiK service only accepts PL-1992 coordinates, not WGS84, so the ETL converts coordinates using custom code (without pyproj).",
    meth_source_inpost_title: "InPost Parcel Lockers",
    meth_source_inpost_desc: "Parcel lockers are sourced from the public InPost ShipX API (type <code>parcel_locker</code>). Each locker is assigned to the administrative division using the same GUGiK geocoder and relational matching as the stores. This is a one-time download - the parcel locker network grows slowly, and we have about {{STAT_INPOST_TOTAL}} points. The comparison of Żabkas vs. parcel lockers - split by voivodeship, district, and commune - is available on the dashboard.",
    meth_source_frogs_title: "Amphibians - GBIF",
    meth_source_frogs_desc: "Amphibian observations in Poland are sourced from the Global Biodiversity Information Facility (Amphibia class, <code>taxonKey=131</code>). We have about {{STAT_GBIF_TOTAL}} records with coordinates. A BallTree (haversine) counts observations within a 5 km radius of each store. The store with the highest number of nearby amphibian observations has {{STAT_AMPHIBIAN_RECORD_COUNT}} - and it is located in Ursynów, Warsaw, not in any national park.",
    meth_source_neighbor_title: "Neighborhood - local calculations",
    meth_source_neighbor_desc: "The distance to the nearest other Żabka is calculated locally via BallTree (haversine, k=2). The most isolated store is {{STAT_ISOLATED_MAX_KM}} km away from its nearest neighbor (Michałowo, Podlaskie). The point farthest from any Żabka - the empty space in the Bieszczady Mountains - is about {{STAT_VOID_DISTANCE_KM}} km away. Zero network queries, pure geometry on the pre-loaded data.",
    meth_source_weather_title: "Weather and Sky - Open-Meteo, OpenLightMap",
    meth_source_weather_desc: "Live weather data (temperature, cloud cover) is retrieved from the free Open-Meteo API for the coldest and warmest Żabka locations. Similarly, the darkest and brightest skies are obtained from OpenLightMap. This live data is fetched when the page opens and is not stored in the database - yesterday's weather is of no use to anyone.",
    meth_sec_pipeline: "ETL Pipeline",
    meth_pipeline_desc: "We run a daily pipeline that downloads, cleans, enriches, and saves the data to the database. It works as follows:",
    meth_etl_step1: "<strong>Download.</strong> We download the public JSON file containing store locations. If the API is unavailable, we fall back to a local file in <code>data/input/</code>.",
    meth_etl_step2: "<strong>Clean.</strong> Deduplication by <code>storeId</code> (about 32 duplicates in the source), normalization of city names (e.g., <code>LEGNICA</code> becomes <code>Legnica</code>), removal of <code>&lt;br&gt;</code> and postal codes from street addresses, and discarding personal data and fixed columns.",
    meth_etl_step3: "<strong>Enrichment.</strong> Each source is processed independently: regions, neighborhood, amphibians, parks, elevation, GUS, and parcel lockers. A failure in one source does not halt the pipeline - the column simply remains NULL and the ETL proceeds. Every network request has a retry policy: 3 attempts with a 60-second delay.",
    meth_etl_step4: "<strong>Diff.</strong> We compare the new snapshot with the previous one: new <code>store_id</code> records indicate openings, while missing ones indicate closures. The result is saved as a history of changes.",
    meth_etl_step5: "<strong>Database Save.</strong> Data is written to the DuckDB database. New columns are added using <code>ALTER TABLE ADD COLUMN IF NOT EXISTS</code> (without DEFAULT, as DuckDB does not support DEFAULT in ALTER). The database stores the last 6 months of snapshots - older ones are pruned.",
    meth_etl_step6: "<strong>Cache Purge.</strong> After a successful ETL run, the Redis cache is cleared. The backend rebuilds cache entries on the next request. Redis is optional - if it is unavailable, the backend works without it.",
    meth_sec_warn: "What We Do Not Guarantee",
    meth_warn_title: "Data Limitations",
    meth_warn_item1: "About {{STAT_UNDATED_STORES}} stores lack an opening date in the source data - they do not appear in the network growth history chart.",
    meth_warn_item2: "District populations are annual data from GUS, not real-time estimates.",
    meth_warn_item3: "Stores on the borders of simplified administrative polygons may be assigned to an adjacent voivodeship (affects about 3 stores).",
    meth_warn_item4: "Opening hours are sourced from Żabka's system, not verified in the field.",
    meth_warn_item5: "Weather data is live and may differ from the offline database.",
    meth_warn_item6: "GBIF observations depend on the activity of observers - sparsely populated regions have fewer records not because there are fewer amphibians, but because fewer people are looking and reporting them.",
    meth_warn_item7: "A missing enrichment source leaves the corresponding column as NULL - the table remains consistent but incomplete.",
    meth_warn_item8: "Soft delete: stores that disappear from the source receive a <code>deleted_at</code> timestamp in the database. Queries filter out deleted stores by default (<code>deleted_at IS NULL</code>), so closed stores do not skew active statistics.",
    meth_foot_back: "Built with public data. <a href=\"/\" class=\"foot-link\">Back to dashboard</a>",

    // Atlas of Extremes (Kraniec) facts
    kr_cap_default: "Click a phenomenon – the map will fly to it and highlight the dots.",
    unit_store_singular: "store",
    unit_store_plural: "stores",
    fact_grp_compass: "Compass – four directions",
    fact_grp_elevation: "Elevation – high and low",
    fact_grp_isolation: "Isolation – loner",
    fact_grp_history: "Network history",
    fact_grp_void: "Void – blank spot",
    fact_grp_frog: "Żabka & frogs",
    fact_grp_h24: "24/7",
    fact_grp_nature: "In the lap of nature",
    fact_grp_twins: "Right next to each other",
    fact_grp_nogap: "Cities without a Żabka",
    fact_desc_nogap: "{city} - {pop} residents and not a single Żabka. The whole gmina has no store, or the nearest one is in a neighbouring town.",
    fact_lab_north: "Farthest north",
    fact_lab_south: "Farthest south",
    fact_lab_east: "Farthest east",
    fact_lab_west: "Farthest west",
    fact_lab_highest: "Highest altitude",
    fact_lab_lowest: "Below sea level",
    fact_lab_isolated: "Farthest from neighbor",
    fact_lab_oldest: "Oldest active",
    fact_lab_void: "Largest void",
    fact_lab_crown: "Crown of the collection",
    fact_lab_frogrecord: "Amphibian record",
    fact_lab_farfrog: "Farthest from frog",
    fact_lab_zerofrog: "No frogs nearby",
    fact_lab_h24: "24/7 stores",
    fact_lab_parks: "In national parks",
    fact_lab_twins: "Stores right next to each other",
    fact_desc_north: "The northernmost Żabka in the country – right by the Baltic cliff.",
    fact_desc_south: "The southern edge: Cisna in the Bieszczady Mountains, the gateway to the peaks.",
    fact_desc_east: "Farthest east – Hrubieszow, almost at the border with Ukraine.",
    fact_desc_west: "The western extreme: Cedynia on the Oder River, a few kilometers from Germany.",
    fact_desc_highest: "The highest situated Żabka in the network.",
    fact_desc_lowest: "The only Żabka below sea level.",
    fact_desc_isolated: "The most isolated Żabka in the network.",
    fact_desc_oldest: "The oldest still operating Żabka in the network. Opened in {year}, active for {age} years.",
    fact_desc_void: "A point in Bieszczady located {distance} km from any Żabka – the largest blank spot on the map.",
    fact_desc_crown: "A Żabka on Green Frog Street.",
    fact_desc_frogrecord: "The highest number of amphibian observations within 5 km among all stores in the network.",
    fact_desc_farfrog: "The Żabka farthest from the nearest amphibian observation.",
    fact_desc_zerofrog: "This many stores do not have a single amphibian observation within a 5 km radius (GBIF, Amphibia). The most isolated: {isolated_store} – {distance} km from the nearest frog.",
    fact_desc_zerofrog_simple: "This many stores do not have a single amphibian observation within a 5 km radius (GBIF, Amphibia).",
    fact_desc_h24: "Żabkas that never close. Very rare in the network – {count} out of {total}.",
    fact_desc_parks: "Stores in landscape parks and buffer zones.",
    fact_desc_twins: "The opposite of the loner: {count} stores have another Żabka within a 50-meter radius.",
    fact_short_zerofrog: "stores with no amphibian observations within 5 km",
    fact_short_h24: "Żabkas that never sleep",
    fact_short_parks: "Żabka in a park or buffer zone",
    fact_short_twins: "network suffocating from density",
    fact_val_zerofrog: "{count} stores",
    fact_val_twins: "{count} within 50 m",

    // i18n coverage audit additions
    meta_title: "Zabka Collector - Interactive Atlas of the Store Network in Poland",
    meta_description: "Interactive atlas of the Zabka network: where, when and how the network of over 13,000 stores grew. Maps, rankings, economics and facts based on public data.",
    og_description: "Where, when and how the network of over 13,000 Zabka stores grew. Maps, rankings, economics and facts based on public data.",
    og_image_alt: "Interactive atlas of Zabka stores in Poland - a dark map with locations and charts",
    jsonld_website_desc: "Interactive atlas of the Zabka network in Poland, based on public data.",
    jsonld_dataset_name: "Zabka network in Poland - locations and statistics",
    jsonld_dataset_desc: "Data on over 13,000 Zabka stores in Poland: locations, opening dates, density, opening hours and correlations with GUS, GBIF, InPost and GUGiK data.",
    lang_toggle_aria: "Language selection",
    chart_growth_aria: "Growth chart of the network: bars show the number of new stores in each year 1998-2026, the line shows the year-over-year percentage change.",
    era_logo_1998_alt: "Zabka logo 1998",
    era_logo_2020_alt: "Zabka logo 2020",
    aria_admin_level: "Administrative level",
    aria_metric: "Metric",
    aria_sort: "Sort",
    aria_map_mode: "Map view mode",
    aria_coverage_level: "Coverage level",
    aria_geo_level: "Geographic level",
    aria_distance_metric: "Distance metric",
    aria_sort_results: "Sort results",
    aria_gmina_metric: "Commune metric",
    chart_nbl_aria: "Bar chart: distance to the nearest store by the selected geographic level and metric.",
    chart_knn_aria: "Histogram: distribution of distance to the nearest store, median 299 m, average 942 m.",
    chart_elevation_aria: "Histogram: distribution of Zabka store elevation above sea level in Poland, in 50-meter buckets.",
    chart_streets_aria: "Bar chart: streets with the most Zabka stores in Poland, with street and city name.",
    chart_gmina_lead_aria: "Bar chart: communes with the most stores per resident or per km², by the selected metric.",
    gran_dim_gmina: "Communes",
    gran_word_gmina: "communes",
    tab_load_error: "Failed to load this tab's data. Check your connection and try again.",
    chart_empty: "No data for the selected filters.",
    map_unavailable_default: "Map unavailable",
    map_unavailable_hint: "Your browser did not provide WebGL. Enable hardware acceleration in your browser settings and refresh the page.",
    map_coop_win: "Use ctrl + scroll to zoom the map",
    map_coop_mac: "Use ⌘ + scroll to zoom the map",
    map_coop_mobile: "Use two fingers to move the map",
    map_reset_view: "Reset view",
    map_reset_view_aria: "Reset map view",
    map_growth_unavailable: "Expansion map unavailable",
    map_voivodeship_unavailable: "Voivodeship map unavailable",
    map_inpost_unavailable: "Zabka vs InPost map unavailable",
    atlas_map_unavailable: "Atlas of Extremes unavailable",
    fpf_tooltip_new: "New:",
    fpf_tooltip_cursor: "Cursor:",
    fpf_tooltip_dominant_year: "year's dominant:",
    chart_growth_xaxis: "Year →",
    chart_growth_new_axis: "↑ New stores",
    months_full: ["January","February","March","April","May","June","July","August","September","October","November","December"],
    months_initial: ["J","F","M","A","M","J","J","A","S","O","N","D"],
    map_tip_per1k_suffix: "/1k res.",
    bucket_others: "Others",
    nbl_axis_meters: "meters to nearest Zabka",
    ratio_label: "ratio",
    brand_zabka: "Zabka",
    nat_avg_prefix: "nat. avg. ",
    inpost_lockers_per_store_suffix: " parcel lockers per Zabka in Poland",
    econ_tip_no_data: "no economic data",
    econ_tip_avg_salary: "Average salary:",
    econ_tip_unemployment: "Unemployment:",
    econ_tip_per1k: "Stores / 1,000 residents:",
    econ_tip_denser: "denser",
    econ_tip_sparser: "sparser",
    econ_tip_trend_suffix: "{word} than the trend predicts ({resid})",
    econ_legend_below: "sparser than trend",
    econ_legend_on: "on trend",
    econ_legend_above: "denser than trend",
    no_data: "no data"
  },
  pl: {
    // Navigation / Tabs
    brand_title: "Żabkozbiór",
    tab_siec: "Sieć",
    tab_spoleczenstwo: "Żabka a Polska",
    skip_link: "Przejdź do treści",
    nav_aria: "Nawigacja główna",
    tablist_aria: "Sekcje dashboardu",
    sr_h1: "Żabkozbiór - interaktywny atlas Żabek",
    play_animation: "Odtwórz animację",



    // Siec Tab - Hero
    hero_number_label_siec: "aktywnych sklepów",
    hero_h1_siec: "Żabka jest wszędzie. Mamy na to twarde dane.",
    hero_lede_siec: "{{STAT_PCT_SINCE_2023}}% dzisiejszej sieci powstało od 2023 roku. Oto jak {{STAT_TOTAL_STORES_WORDS}} sklepów rozlało się po Polsce, rok po roku.",
    data_disclaimer_header: "Maly disclaimer na poczatek",
    data_disclaimer: "Ten dashboard pokazuje wyłącznie sklepy <b>działające dziś</b>. Historię otwarć i zamknięć śledzimy dopiero od <b>17 czerwca 2026</b> - starsze dane o zamkniętych Żabkach po prostu nie istnieją, więc trendy sprzed tej daty pokazują tylko sklepy, które przetrwały do teraz.",

    // Siec Tab - Stat Strip
    stat_kicker_startup: "Rozruch",
    stat_sub_startup: "zajął pierwszy <b>1 000</b> sklepów",
    stat_unit_years: "lat",
    stat_kicker_accel: "Przyspieszenie",
    stat_sub_accel: "zajęły ostatnie <b>5 000</b>",
    stat_kicker_hoursstd: "Standardowe godziny",
    stat_sub_hoursstd: "sklepów działa w standardowych godzinach 06:00-23:00 pon-sob",
    stat_kicker_neighbor: "Najbliższy sąsiad",
    stat_sub_neighbor: "mediana odległości do najbliższej Żabki",
    stat_unit_meters: " m",
    stat_kicker_cities: "Miast z Żabką",
    stat_sub_cities: "polskich miast (gmin miejskich) ma Żabkę",
    stat_kicker_new_month: "Nowe w tym miesiącu",
    stat_sub_new_month: "sklepów otwartych w ostatnim miesiącu",

    // Expansion Map & Calendar
    map_growth_title: "Tak rosła sieć: 1998-{{STAT_DATA_YEAR_MAX}}",
    map_growth_sub: "Każdy sklep to kropka, która pojawia się w roku otwarcia. Obok kalendarz otwarć miesiąc po miesiącu. Suwak prowadzi oba.",
    calendar_aria_label: "Kalendarz otwarć sklepów miesiąc po miesiącu, 1998-{{STAT_DATA_YEAR_MAX}}. Ciemniejsze pola oznaczają więcej otwarć w danym miesiącu.",
    slider_year_label: "Rok ekspansji sieci",

    // Growth Chart
    chart_growth_title: "Kiedy otwierano sklepy",
    chart_growth_sub: "Słupki: nowe sklepy w roku (oś po lewej). Linia: zmiana rok do roku, % (oś po prawej)",
    chart_growth_legend_new: "Nowe sklepy",
    chart_growth_legend_yoy: "Zmiana r/r",
    chart_growth_yoy_axis: "Zmiana r/r (%)",
    chart_growth_survival_note: "Bias przeżywalności: tylko aktywne sklepy - zamknięte wypadły z datasetu. Wczesne lata (1998-2010) niedoszacowane. {{STAT_UNDATED_STORES}} sklepów bez daty pominięto.",

    // Origins Card
    origin_old_kicker: "Najstarsza (wciąż działa)",
    origin_old_note: "otwarta",
    origin_old_note_suffix: " - i nadal na mapie",
    origin_new_kicker: "Najnowsza Żabka",
    origin_new_note: "otwarta",
    origin_new_note_suffix: " - najświeższy punkt na mapie",

    // Fingerprint Card
    fingerprint_title: "Kompas wyprostowany - słoje lat, kierunek N-E-S-W-N",
    fingerprint_sub: "Te same dane rozwinięte z układu biegunowego: oś X to kierunek (N-E-S-W-N), oś Y to rok. Każdy słój to jeden rok, a wybrzuszenie to dominujący kierunek ekspansji (region Polski). Najedź na słój po szczegóły.",
    fingerprint_aria: "Kompas wyprostowany: każdy poziomy słój to rok 1998-{{STAT_DATA_YEAR_MAX}}, wybrzuszenie pokazuje dominujący kierunek ekspansji sieci w danym roku (N-E-S-W-N). Najedź na słój, żeby zobaczyć szczegóły.",
    fingerprint_hint_mouse: "Najedź na słój - każdy poziomy pas to jeden rok ekspansji.",
    fingerprint_hint_touch: "Dotknij i przesuń po słoju - każdy poziomy pas to jeden rok ekspansji.",

    // Bridge Cards
    bridge_expansion: "Kierunek ekspansji rok po roku to jedna historia. Druga: ile sklepów i gdzie. {{STAT_LEADER_ABSOLUTE_VOIV}} prowadzi w liczbach bezwzględnych, ale per capita wygrywa {{STAT_LEADER_PERCAPITA_VOIV}}.",
    bridge_econ_text: "Sieć wygląda równomiernie. Dane odsłaniają obraz pod spodem.",
    bridge_econ: "Bogatsze powiaty mają więcej sklepów. Zachód zamyka w niedziele, choć reszta nie. 32 Żabki mają odległość do najbliższej Żabki równą 0. Sprawmy, jak to możliwe i jak jeszcze Żabka wpisuje się w obraz współczesnej Polski.",

    // Najwiecej Zabek (Granular)
    gran_title: "Najwięcej Żabek - powiaty",
    gran_sub: "liczba aktywnych sklepów",
    gran_dim_woj: "Woj.",
    gran_dim_powiat: "Powiaty",
    gran_dim_city: "Miasta",
    gran_metric_count: "Liczba",
    gran_metric_per1k: "żab./1000mieszk.",
    gran_metric_per_km2: "żab./km²",
    gran_sort_desc: "Największe",
    gran_sort_asc: "Najmniejsze",
    gran_chart_aria: "Ranking jednostek administracyjnych według liczby sklepów Żabka. Przełączniki nad wykresem pozwalają wybrać poziom i metrykę.",
    gran_ref_others: "Pozostałe (śr.)",

    // KPI Strip (Atlas krancow)
    edge_kpi_h24: "Sklepy 24/7",
    edge_kpi_h24_sub: "nigdy się nie zamyka",
    edge_kpi_h24_tile: "Sklepy 24/7 - pokaż na mapie",
    edge_kpi_parks: "W parkach",
    edge_kpi_parks_sub: "sklepów w parkach i rezerwatach",
    edge_kpi_parks_tile: "Sklepy w parkach - pokaż na mapie",
    edge_kpi_frogs: "Rekord płaza",
    edge_kpi_frogs_sub: "obserwacji płazów przy jednej Żabce",
    edge_kpi_frogrecord_tile: "Rekord płaza - pokaż na mapie",
    edge_kpi_void: "Pustka Bieszczad",
    edge_kpi_void_sub: "maksymalny dystans do Żabki w Polsce.",
    edge_kpi_void_tile: "Pustka Bieszczad - pokaż na mapie",
    edge_kpi_oldest: "Najstarsza aktywna",
    edge_kpi_oldest_sub: "Swarzędz - działa od 28 lat",
    edge_kpi_oldest_tile: "Najstarsza aktywna Żabka - pokaż na mapie",
    edge_kpi_farthest: "Najdalej od żaby",
    edge_kpi_farthest_sub: "dystans do najbliższej obserwacji płaza",
    edge_kpi_farthestfrog_tile: "Najdalej od żaby - pokaż na mapie",

    // Atlas krancow map
    atlas_title: "Atlas krańców",
    atlas_reset: "Powrót do pełnej mapy",
    map_zoom_hint_mouse: "ctrl + scroll przybliża",
    map_zoom_hint_touch: "uszczypnij by przybliżyć",

    // Extremes Panels
    ep_frog_panel: "Żabka na ulicy Zielonej Żabki - pokaż na mapie",
    ep_frog_eyebrow: "Perła kolekcji",
    ep_frog_city: "Żabia Wola, mazowieckie",
    ep_frog_note: "Żabka przy ulicy Zielonej Żabki - idealny marketingowy zbieg okoliczności.",
    ep_highest_panel: "Najwyżej położony sklep - pokaż na mapie",
    ep_highest_eyebrow: "Najwyżej n.p.m.",
    ep_highest_city: "Kościelisko, małopolskie",
    ep_highest_street: "Nędzy Kubińca 101",
    ep_lowest_panel: "Sklep poniżej poziomu morza - pokaż na mapie",
    ep_lowest_eyebrow: "Jedyna poniżej morza",
    ep_lowest_city: "Gdańsk (port), pomorskie",
    ep_lowest_street: "Przełom 12",
    ep_isolated_panel: "Najbardziej odizolowany sklep - pokaż na mapie",
    ep_isolated_eyebrow: "Najdalej od innej Żabki",
    ep_isolated_city: "Michałowo, podlaskie",
    ep_isolated_street: "Białostocka 2",
    ep_zerofrog_panel: "Sklep bez żab (obserwacji) w pobliżu - pokaż na mapie",
    ep_zerofrog_eyebrow: "Żabka bez żadnej żaby w pobliżu",
    ep_zerofrog_sub: "sklepów bez ani jednej obserwacji płaza w promieniu 5 km",
    oldest_active_sub: "{city} - działa od {age} lat",
    ep_zerofrog_note: "sklepów ({pct}%) bez ani jednej obserwacji płaza w promieniu 5 km",
    frog_street_note: "Żabka przy ulicy Zielonej Żabki.",
    cities_funnel_text: "z {total} polskich miast ma Żabkę",
    tooltip_year: "Rok: {year}",
    tooltip_new_stores: "Nowe sklepy: {count}",
    tooltip_yoy: "Zmiana r/r: {pct}",
    load_more_format: "Załaduj więcej ({current}/{total})",
    gran_word_voivodeship: "województwa",
    gran_word_powiat: "powiaty",
    gran_word_city: "miasta",
    gran_metric_per1k_label: "sklepy na 1000 mieszkańców",
    gran_metric_per_km2_label: "sklepy na km²",
    gran_title_format_asc: "Najmniej Żabek - {word}",
    gran_title_format_desc: "Najwięcej Żabek - {word}",
    legend_avg: "śr. {val}",
    legend_median: "mediana {val}",
    suffix_per1k: "żab./1k",
    suffix_per_km2: "żab./km²",
    lead_totals_template: "<b>{total}</b> sklepów w <b>{powiats}</b> powiatach. W dwóch rozdziałach sprawdzamy, czy gęstość sieci idzie za <b>pieniędzmi</b> i za <b>pracą</b> - i co tak naprawdę mówią o tym liczby.",
    resort_sub_per1k: "gminy wg sklepów na 1000 zameldowanych - morze i góry biją resztę kraju",
    resort_sub_perkm2: "gminy wg sklepów na km² - tu wygrywają wielkie miasta",
    nbl_sub_template: "{metric} odległości do najbliższej Żabki, według {level}",
    dumbbell_title_template: "Żabka vs InPost - top {length} {label} alfabetycznie ({total} łącznie)",

    // Coverage Donut
    coverage_title: "Żabka jest niemal wszędzie",
    coverage_sub: "odsetek jednostek z Żabką - zielone: pokryte, czerwone: bez",
    coverage_donut_aria: "Wykres kołowy: odsetek jednostek administracyjnych z co najmniej jedną Żabką.",
    coverage_map_aria: "Mapa Polski: zielone jednostki mają Żabkę, czerwone nie mają.",
    coverage_suffix_powiat: "powiatów ma Żabkę",
    coverage_suffix_city: "miast ma Żabkę",
    coverage_suffix_gmina: "gmin ma Żabkę",

    // City Gap (miasta bez Żabki)
    citygap_title: "Miasta bez Żabki",
    citygap_sub: "{count} z {total} miast ({pct}%) nie ma ani jednej Żabki - posortowane wg liczby mieszkańców",
    citygap_empty: "Każde miasto w Polsce ma przynajmniej jedną Żabkę.",
    citygap_pop_unit: " mieszk.",

    // Bubble Chart
    bubble_title: "Z czego składa się sieć - miasta",
    bubble_sub: "Wielkość bąbla to liczba sklepów. Kliknij na jeden i przeciągnij. Małe jednostki trafiają do „Pozostałych\".",

    // Spoleczenstwo Tab - Hero
    hero_eyebrow_spol: "Żabka a Polska - Kultura i naród",
    hero_h1_spol: "Maksymalny dystans do Żabki w Polsce.",
    hero_lede_spol: "W Polsce Żabka czuje się jak płaz w wodzie. W prawie 30 lat stała się jednym z kulturowych symboli Polski. Zobaczmy, gdzie jeszcze wpisuje się w polską kulturę. A może ją nadpisuje?",

    // Spoleczenstwo Tab - KPI Strip
    spol_kpi_residents_kicker: "Jeden sklep na",
    spol_kpi_residents_unit: " os.",
    spol_kpi_residents_sub: "mieszkańców Polski",
    spol_kpi_gminy_kicker: "Pokrycie gmin",
    spol_kpi_gminy_sub: "gmin ma co najmniej jedną Żabkę",
    spol_kpi_density_kicker: "Gęstość skrajna",
    spol_kpi_density_sub_tpl: "{name}: najgęstsza sieć w kraju",
    spol_kpi_gminaleader_kicker: "Rekordzista per capita",
    spol_kpi_gminaleader_sub_tpl: "{name}: najwięcej Żabek na mieszkańca w Polsce",
    spol_kpi_inpostmax_kicker: "Skrajność InPost",
    spol_kpi_inpostmax_sub_tpl: "{name}: najwięcej paczkomatów na jedną Żabkę",
    spol_kpi_sunday_kicker: "Ściana niedzielna",
    spol_kpi_sunday_sub_tpl: "{name}: zamknięte w niedzielę vs średnia krajowa",

    // Żabka vs InPost
    inpost_title: "Żabka vs InPost",
    inpost_sub: "Pojedynek dwóch gigantów polskiej przestrzeni publicznej. Obaj robią co innego - Żabka to zakupy, InPost to odbiory paczek - ale oba rywalizują o ten sam metr kwadratowy ulicy.",
    legend_Żabka_100k: "Żabka/100k",
    legend_inpost_100k: "InPost/100k",

    // KNN (Density)
    knn_title: "Jak gęsto stoją Żabki - typowy dystans do sąsiadki",
    knn_sub: "mediana odległości do najbliższej Żabki, według województwa",
    knn_median: "Mediana",
    knn_mean: "Średnia",
    knn_rarest: "Najrzadsze",
    knn_densest: "Najgęstsze",
    knn_caveat: "Mediana jest odporna na pojedyncze samotne sklepy; średnią zawyżają wartości skrajne (w podkarpackiem średnia to ~{{STAT_PODKARPACKIE_AVG_KM}} km, a mediana {{STAT_PODKARPACKIE_MEDIAN_M}} m).",
    knn_half_title: "Połowa sieci ma sąsiadkę bliżej niż {{STAT_NEIGHBOR_MEDIAN_M}} m",
    knn_half_sub: "Rozkład odległości do najbliższego sklepu (k-NN).",
    knn_stat_max: "maks.",

    // Elevation
    ele_title: "Od portu w Gdańsku po szczyt w Tatrach",
    ele_sub: "Rozkład wysokości czynnych sklepów nad poziomem morza, w kubełkach co 50 m.",
    ele_caveat: "Skrajności to pojedyncze punkty: sklep w porcie w Gdańsku leży poniżej poziomu morza, a w Kościelisku pod Tatrami najwyżej w całej sieci. 90% sklepów mieści się między liniami P5 i P95.",

    // Streets
    streets_title: "Ulice z największą liczbą Żabek",
    streets_sub_prefix: "Konkretna ulica i miasto, nie sama nazwa - łącznie ",
    streets_sub_suffix: " sklepów",

    // Resort Communes
    resort_title: "Najwięcej Żabek na mieszkańca? Kurorty.",
    resort_sub: "gminy wg sklepów na 1000 zameldowanych - morze i góry biją resztę kraju",
    resort_caveat: "Liczba mieszkańców to zameldowani, a latem w kurortach jest ich wielokrotnie więcej. I o to właśnie chodzi: sieć idzie za turystą, nie za meldunkiem.",

    // Econ maps
    econ_intro_title: "Gdzie Żabek jest więcej, niż wynikałoby z ekonomii",
    econ_intro_sub: "Dwie mapy powiatów. Kolor to nie surowe zagęszczenie, tylko odchylenie od trendu: o ile sklepów na 1000 mieszkańców jest więcej (zielony) albo mniej (czerwony), niż przewiduje prosta zależność od danego wskaźnika. Biały powiat leży dokładnie na linii trendu. Zieleń tam, gdzie sieć jest gęstsza, niż tłumaczyłaby to ekonomia.",
    econ_unemp_title: "Reszty wobec bezrobocia",
    econ_unemp_sub: "Zwykle im wyższe bezrobocie, tym rzadsza sieć. Zieleń pokazuje powiaty, które i tak mają więcej Żabek, niż sugeruje bezrobocie.",
    econ_salary_title: "Reszty wobec płacy",
    econ_salary_sub: "Bogatsze powiaty mają gęstszą sieć. Zieleń = gęściej, czerwień = rzadziej, niż wynikałoby z samej płacy.",
    econ_error_load: "Nie udało się załadować danych.",
    econ_error_retry: "Spróbuj ponownie",

    // Footer
    foot_built_with: "Zbudowane z danych publicznych",
    foot_methodology: "Metodyka",
    foot_portfolio: "Portfolio",
    foot_last_updated: "Aktualizacja danych",
    foot_disclaimer: "Niezależny projekt fanowski/analityczny na danych publicznych. Niezwiązany z Żabka Polska ani Żabka Group. Znaki towarowe należą do ich właścicieli.",

    // Deep links / copy-link (S1)
    copy_link_aria: "Skopiuj link do tej sekcji",
    link_copied: "Skopiowano link",
    link_copy_failed: "Nie udało się skopiować linku",

    // Link do dedykowanej strony FAQ (/faq.html - treść PL-only, jak
    // methodology.html, więc tłumaczona jest tylko etykieta linku)
    nav_faq_link: "FAQ",
    nav_methodology_link: "Metodyka",

    // PNG export toolbar (S3)
    export_copy_aria: "Kopiuj obraz do schowka",
    export_download_aria: "Pobierz jako PNG",
    export_copied: "Skopiowano obraz",
    export_copy_failed: "Nie udało się skopiować obrazu",
    export_not_ready: "Jeszcze się nie załadowało - spróbuj za chwilę",

    stat_unit_meters_km: " km",

    // FAQ Page
    faq_title: "FAQ - najczęstsze pytania o sieć Żabka i te dane",
    faq_meta_desc: "Ile jest Żabek w Polsce, gdzie jest ich najwięcej, jak daleko do najbliższej - i dlaczego korelacja na mapach ekonomicznych nie znaczy przyczynowości. Pytania i odpowiedzi, z danymi.",
    faq_h1: "FAQ",
    faq_sub: "Najczęstsze pytania o sieć Żabka - z danymi, nie z wyczuciem. I te pytania, które *powinny* paść, kiedy ktoś patrzy na mapy korelacji, ale zwykle nie padają.",
    faq_disclaimer: "Żabkozbiór to niezależny projekt fanowski/analityczny oparty na danych publicznych. Nie jest powiązany z Żabka Polska sp. z o.o. ani Żabka Group. Nazwa \"Żabka\" i powiązane znaki towarowe należą do ich właścicieli.",
    faq_sec_facts: "Podstawowe fakty o sieci",
    faq_q_count: "Ile jest Żabek w Polsce?",
    faq_a_count: "Ponad {{STAT_TOTAL_STORES_ROUNDED}} aktywnych sklepów, w ponad {{STAT_CITIES_COUNT_ROUNDED}} miastach i miejscowościach. Liczba zmienia się codziennie - sieć otwiera nowe punkty praktycznie bez przerwy, choć część sklepów też zamyka się po drodze (patrz niżej).",
    faq_q_most: "Gdzie jest najwięcej Żabek?",
    faq_a_most: "W liczbach bezwzględnych: Warszawa (ponad {{STAT_WARSAW_STORE_COUNT}} sklepów) i województwo {{STAT_LEADER_ABSOLUTE_VOIV}} jako całość. Ale to głównie efekt wielkości miasta i regionu - większa populacja, więcej sklepów, bez wyjątku. Licząc na mieszkańca, prowadzi {{STAT_LEADER_PERCAPITA_VOIV}} (ok. {{STAT_LEADER_PERCAPITA_VALUE}} sklepu na 1000 osób), nie {{STAT_LEADER_ABSOLUTE_VOIV}}. Ranking odwraca się w zależności od tego, co dzielisz przez co - to nie przypadek, to dokładnie ten sam mechanizm, który opisujemy w sekcji o mieszaniu liczb bezwzględnych z gęstością niżej.",
    faq_q_farthest: "Gdzie jest najdalej do Żabki?",
    faq_a_farthest: "Najdalszy punkt od jakiejkolwiek Żabki w Polsce leży w Bieszczadach, około {{STAT_VOID_DISTANCE_KM}} km w linii prostej od najbliższego sklepu. To praktycznie środek Połoniny Wetlińskiej.",
    faq_q_yearly: "Ile Żabek przybywa rocznie?",
    faq_a_yearly: "Rocznie otwiera się od kilkuset do ponad {{STAT_RECORD_YEAR_OPENINGS}} nowych sklepów - rekordowy był {{STAT_RECORD_YEAR}} rok z {{STAT_RECORD_YEAR_OPENINGS}} otwarciami. {{STAT_PCT_SINCE_2023}}% dzisiejszej, wciąż aktywnej sieci powstała od 2023 roku. Tempo przyspieszyło zauważalnie po 2020.",
    faq_q_closes: "Czy Żabka też zamyka sklepy, czy tylko otwiera nowe?",
    faq_a_closes: "Tak, zamyka - to normalna rotacja sieci convenience, nie coś wyjątkowego. Problem jest inny: nasz wykres historii wzrostu (na dashboardzie, sekcja Sieć) liczy otwarcia tylko dla sklepów, które są aktywne <em>dziś</em>. Sklep, który otworzył się w 2015 i zamknął w 2022, po prostu nie istnieje w tym wykresie - jakby nigdy go nie było. To sprawia, że wcześniejsze lata wyglądają na słabsze niż realnie były (patrz \"survivorship bias\" niżej). Zamykanie sklepów zaczęliśmy śledzić dopiero, odkąd ten projekt działa - to osobna, znacznie krótsza historia.",
    faq_q_every_city: "Czy Żabka jest w każdym mieście w Polsce?",
    faq_a_every_city: "Nie, ale jest blisko - ponad {{STAT_GMINY_COVERAGE_PCT}}% gmin ma co najmniej jedną Żabkę, a pokrycie powiatów jest praktycznie kompletne ({{STAT_POWIAT_COVERED}} z {{STAT_POWIAT_TOTAL}} powiatów lądowych ma przynajmniej jeden sklep). Miejsca bez Żabki to głównie małe, rozproszone gminy wiejskie.",
    faq_sec_sources: "Skąd pochodzą te dane",
    faq_q_source_origin: "Skąd pochodzą te dane?",
    faq_a_source_origin: "Główne źródło to publiczny plik lokalizatora sklepów na <code>Żabka.pl</code> - ten sam, z którego korzysta wyszukiwarka sklepów na ich stronie. Wzbogacamy go danymi GUS BDL (zarobki, bezrobocie, populacja), GBIF (obserwacje płazów), InPost ShipX (paczkomaty) i GUGiK (granice administracyjne, geokodowanie, wysokość terenu). Pełny opis źródeł, cały potok ETL i lista znanych ograniczeń są na <a href=\"/methodology.html\">stronie metodyki</a>.",
    faq_q_update_freq: "Jak często aktualizowane są dane?",
    faq_a_update_freq: "Codziennie, automatycznym potokiem o 3:00 w nocy czasu warszawskiego. Ekonomiczne dane GUS (zarobki, bezrobocie, populacja) aktualizują się rzadziej, bo GUS sam publikuje je raz w roku.",
    faq_q_download: "Czy mogę pobrać te dane samodzielnie?",
    faq_a_download: "Tak. Cała baza DuckDB (~{{STAT_DB_SIZE_MB}} MB) jest do pobrania z dashboardu, na licencji CC BY 4.0. Granice województw są dostępne jako GeoJSON. Surowe API jest udokumentowane pod <code>/docs</code>.",
    faq_q_official: "Czy to oficjalna strona Żabki?",
    faq_a_official: "Nie. Żabkozbiór jest niezależnym projektem fanowskim/analitycznym na danych publicznych, niezwiązanym z Żabka Polska sp. z o.o. ani Żabka Group. Nazwa \"Żabka\" i powiązane znaki towarowe należą do ich właścicieli.",
    faq_sec_pitfalls: "Częste błędne wnioski",
    faq_pitfalls_note: "Ta sekcja istnieje, bo dane statystyczne łatwo naginają się do historii, którą chcemy usłyszeć. Poniżej są konkretne pułapki, w które łatwo wpaść, patrząc na ten dashboard - i dlaczego wniosek \"oczywisty na pierwszy rzut oka\" bywa nieprawdziwy.",
    faq_q_econ_correlation: "Czy wysoka korelacja na mapach ekonomicznych oznacza, że bogactwo powoduje więcej Żabek?",
    faq_a_econ_correlation: "Nie - i to jest najważniejsza pułapka na całym dashboardzie. Mapy w sekcji \"Żabka a Polska\" pokazują <strong>korelację</strong>: odchylenie gęstości sieci od trendu wyznaczonego przez zarobki lub bezrobocie w danym powiecie. Współczynnik r (np. r = +{{STAT_R_SALARY}} dla płacy) opisuje siłę tej zależności statystycznej - nie mechanizm przyczynowy. Równie dobrze mogłoby być odwrotnie (więcej sklepów napędza lokalną gospodarkę), albo - najbardziej prawdopodobnie - obie zmienne zależą od trzeciego czynnika: gęstości zaludnienia i urbanizacji. Bogate powiaty są zwykle też gęściej zaludnione i bardziej zurbanizowane, a to jest to, co realnie przyciąga sieci convenience - nie sama obecność pieniądza.",
    faq_q_amphibians_density: "Czy więcej obserwacji płazów w GBIF przy danym sklepie znaczy, że tam żyje więcej żab?",
    faq_a_amphibians_density: "Niekoniecznie. Rekordzista (ponad {{STAT_AMPHIBIAN_RECORD_COUNT}} obserwacji w promieniu 5 km) to sklep na Ursynowie w Warszawie - gęsto zaludnionej dzielnicy z parkami, nie rezerwacie przyrody. Dane GBIF to zgłoszenia obywatelskiej nauki: odzwierciedlają gęstość <em>obserwatorów</em> ze smartfonami, nie tylko gęstość płazów. Dziewicze, słabo zamieszkane tereny (Bieszczady, Puszcza Białowieska) mogą mieć realnie więcej płazów i mniej zgłoszeń - po prostu mniej osób tam patrzy i wgrywa obserwacje.",
    faq_q_growth_bias: "Czy wykres wzrostu sieci od 1998 roku pokazuje pełną historię otwarć?",
    faq_a_growth_bias: "Nie - to jest survivorship bias w czystej formie. Wykres liczy otwarcia wyłącznie dla sklepów, które są aktywne <em>dziś</em>. Sklep, który otworzył się w 2003 i zamknął w 2015, jest niewidoczny - jakby nigdy nie istniał. To sprawia, że wczesne lata (1998-2010) wyglądają na słabsze, niż realnie były, bo część tamtej kohorty już wypadła z danych. Krzywa, którą widzisz, to \"historia zwycięzców\", nie kompletna historia sieci.",
    faq_q_saturation_warsaw: "Skoro Warszawa ma najwięcej Żabek, to znaczy, że rynek jest tam najbardziej nasycony?",
    faq_a_saturation_warsaw: "Nie wynika to z samej liczby. Ranking liczb bezwzględnych to w gruncie rzeczy ranking wielkości miast i regionów - większa populacja, więcej sklepów, praktycznie bez wyjątku. Żeby ocenić realne nasycenie, trzeba znormalizować: sklepów na 1000 mieszkańców albo na km². Te dwa ranking wyglądają zupełnie inaczej niż ranking liczb bezwzględnych (patrz sekcja GRAN na dashboardzie, z przełącznikiem między metrykami) - i to jest dokładnie powód, dla którego ten przełącznik istnieje.",
    faq_q_sunday_strategy: "Czy różnice w otwarciu w niedzielę między województwami to celowa strategia regionalna?",
    faq_a_sunday_strategy: "Dane pokazują tylko wynik (flaga <code>open_sunday</code> per sklep), nie przyczynę. Różnice w odsetku sklepów zamkniętych w niedzielę między regionami odzwierciedlają najpewniej lokalne wzorce ruchu klientów i indywidualne decyzje na poziomie pojedynczych punktów (część placówek korzysta z wyjątków od ustawowego zakazu handlu, np. na stacjach paliw czy w miejscach o określonej strukturze przychodów) - nie scentralizowaną politykę \"zamykamy zachód, a nie wschód\".",
    faq_q_completeness: "Czy ten zbiór danych jest kompletny i wolny od brakujących wartości?",
    faq_a_completeness: "Nie. Około {{STAT_UNDATED_STORES}} sklepów nie ma daty otwarcia w źródle. Wysokość terenu jest opcjonalna (wymaga ponad {{STAT_TOTAL_STORES_ROUNDED}} zapytań HTTP) i bywa NULL. Populacje powiatów to dane roczne z GUS, nie aktualne szacunki. Pełna lista ograniczeń jest na <a href=\"/methodology.html#czego-nie-gwarantujemy\">stronie metodyki</a>.",
    faq_cta_text: "Chcesz zobaczyć te dane na mapach i wykresach, nie w tekście?",
    faq_cta_btn: "Otwórz dashboard →",
    faq_foot_back: "Zbudowane z danych publicznych. <a href=\"/\" class=\"foot-link\">Powrót na dashboard</a> - <a href=\"/methodology.html\" class=\"foot-link\">Metodyka</a>",
    nav_back_dashboard: "Powrót na dashboard",

    // Methodology Page
    meth_title: "Metodyka i źródła danych - Żabka w liczbach",
    meth_meta_desc: "Skąd pochodzą dane o sieci Żabka: lokalizator sklepów, GUS BDL, GBIF, InPost i GUGiK. Pełna metodyka, definicje i znane ograniczenia.",
    meth_h1: "Metodyka",
    meth_sub: "Skąd bierzemy dane, co z nimi robimy i czego nie wiemy. Źródła, ograniczenia i cały pipeline krok po kroku.",
    meth_disclaimer: "Żabkozbiór to niezależny projekt fanowski/analityczny oparty na danych publicznych. Nie jest powiązany z Żabka Polska sp. z o.o. ani Żabka Group. Nazwa \"Żabka\" i powiązane znaki towarowe należą do ich właścicieli.",
    meth_sec_sources: "Źródła danych",
    meth_source_main_title: "Żabka - główne źródło",
    meth_source_main_desc: "Lokalizacje sklepów pochodzą z publicznego pliku JSON na <code>Żabka.pl</code> - to ten sam plik, z którego korzysta sklepowa wyszukiwarka na ich stronie. Plik ma około {{STAT_TOTAL_STORES_ROUNDED}} sklepów, każdy ze współrzędnymi GPS, adresem, godzinami otwarcia i flagami (piec Merrychef, otwarte w niedzielę, 24/7). Z pliku wyrzucamy dane osobowe dyrektorów, stałe pola (kraj, aktywność) i marketingowe URLe. Zostają same dane analityczne.",
    meth_source_map_title: "Podział administracyjny i mapowanie",
    meth_source_map_desc: "Strukturę podziału terytorialnego Polski (trzy poziomy: województwa, powiaty i gminy) budujemy bezpośrednio z oficjalnych rejestrów GUS BDL oraz TERYT jako pierwszy krok procesu ETL. Sklepy oraz paczkomaty przypisujemy do tej hierarchii relacyjnie na podstawie ich nazw miejscowości, z wykorzystaniem oficjalnej Uniwersalnej Usługi Geokodowania GUGiK do jednoznacznego rozstrzygania przynależności mniejszych miejscowości i wsi, wraz z zapasowym dopasowaniem przestrzennym. Eliminuje to potrzebę stosowania uproszczonych plików GeoJSON i powolnych testów punkt-w-poligon.",
    meth_source_econ_title: "Gospodarka - GUS BDL",
    meth_source_econ_desc: "Zarobki, bezrobocie i populacja na poziomie powiatów pochodzą z Banku Danych Lokalnych (zmienne 64428, 60270, 72305). Pobieramy je raz w roku. Nazwy powiatów trzeba normalizować - GUS lubi dodawać prefiksy (<code>Powiat m.</code>), przyrostki czasowe (<code>od 2023</code>) i zmieniać nazwy (<code>jeleniogórski</code> staje się <code>karkonoski</code> w 2021). Wszystko to czyścimy przed zmatchowaniem. Dokładność: dane pochodzą z roku, w którym GUS je opublikował, nie z bieżącego miesiąca.",
    meth_source_parks_title: "Parki narodowe i krajobrazowe - GDOŚ",
    meth_source_parks_desc: "Granice parków i ich otulin pobieramy z WFS GDOŚ (warstwy <code>ParkiNarodowe</code> + <code>ParkiKrajobrazowe</code>). Mamy {{STAT_PARKS_TOTAL}} obiektów: {{STAT_PARKS_NATIONAL}} parków narodowych z otulinami i {{STAT_PARKS_LANDSCAPE}} krajobrazowych. Każdy sklep sprawdzamy punkt-w-poligon - jeśli trafił do parku lub otuliny, dostaje flagę.",
    meth_source_elev_title: "Wysokość terenu - GUGiK NMT",
    meth_source_elev_desc: "Wysokość n.p.m. z Numerycznego Modelu Terenu GUGiK (<code>GetHByXY</code>, współrzędne PL-1992). To jest opt-in (flaga <code>--elevation</code>), bo ponad {{STAT_TOTAL_STORES_ROUNDED}} zapytań HTTP. Wyniki trafiają do lokalnego cache (<code>elevation_cache.json</code>) - ponowne odpalenie ETL nie odpytuje punktów, które już mamy. Uwaga: serwis GUGiK przyjmuje tylko współrzędne PL-1992, nie WGS84, więc w ETL jest konwersja własnym kodem (bez pyproj).",
    meth_source_inpost_title: "Paczkomaty InPost",
    meth_source_inpost_desc: "Punkty paczkowe z publicznego API InPost ShipX (typ <code>parcel_locker</code>). Każdy paczkomat przypisujemy do podziału administracyjnego za pomocą tego samego geokodera GUGiK i relacyjnego dopasowania co sklepy. To jest jednorazowe pobranie - sieć paczkomatów rośnie wolno, mamy około {{STAT_INPOST_TOTAL}} punktów. Porównanie Żabek vs paczkomaty - z podziałem na województwa, powiaty i gminy - jest na dashboardzie.",
    meth_source_frogs_title: "Płazy - GBIF",
    meth_source_frogs_desc: "Obserwacje płazów z Global Biodiversity Information Facility (klasa Amphibia, <code>taxonKey=131</code>) w Polsce. Mamy około {{STAT_GBIF_TOTAL}} rekordów ze współrzędnymi. BallTree (haversine) zlicza obserwacje w promieniu 5 km od każdego sklepu. Najbardziej żabia Żabka ma {{STAT_AMPHIBIAN_RECORD_COUNT}} obserwacji - i to jest w Ursynowie, nie w żadnym parku narodowym.",
    meth_source_neighbor_title: "Sąsiedztwo - obliczenia lokalne",
    meth_source_neighbor_desc: "Odległość do najbliższej innej Żabki obliczamy lokalnie przez BallTree (haversine, k=2). Najbardziej odosobniony sklep ma {{STAT_ISOLATED_MAX_KM}} km do najbliższego sąsiada (Michałowo, podlaskie). Punkt najdalszy od jakiejkolwiek Żabki - pusta przestrzeń w Bieszczady - to około {{STAT_VOID_DISTANCE_KM}} km. Zero zapytań sieciowych, czysta geometria na danych już wczytanych.",
    meth_source_weather_title: "Pogoda i niebo - Open-Meteo, OpenLightMap",
    meth_source_weather_desc: "Aktualne dane pogodowe z darmowego API Open-Meteo (temperatura, zachmurzenie) dla najzimniejszej i najcieplejszej lokalizacji Żabki. Podobnie najciemniejsze i najjaśniejsze niebo z OpenLightMap. Dane live, pobierane przy otwarciu strony. Nie wypiekamy ich do bazy - pogoda z wczoraj nikomu nie potrzebna.",
    meth_sec_pipeline: "Potok ETL",
    meth_pipeline_desc: "Mamy codzienny potok, który pobiera dane, czyści, wzbogaca i zapisuje do bazy. Wygląda tak:",
    meth_etl_step1: "<strong>Pobranie.</strong> Pobieramy publiczny plik JSON z lokalizacjami sklepów. Jak API niedostępne, bierzemy z lokalnego pliku fallback z <code>data/input/</code>.",
    meth_etl_step2: "<strong>Oczyszczenie.</strong> Deduplikacja po <code>storeId</code> (około 32 duplikaty w źródłach), normalizacja nazw miast (<code>LEGNICA</code> staje się <code>Legnica</code>), usuwanie <code>&lt;br&gt;</code> i kodów pocztowych z ulic, wyrzucenie danych osobowych i stałych pól.",
    meth_etl_step3: "<strong>Wzbogacenie.</strong> Każde źródło niezależnie: regiony, sąsiedztwo, płazy, parki, elewacja, GUS, paczkomaty. Błąd jednego źródła nie przerywa potoku - kolumna zostaje NULL i ETL idzie dalej. Każde zapytanie sieciowe ma retry: 3 próby z odstępem 60 sekund.",
    meth_etl_step4: "<strong>Diff.</strong> Porównujemy z poprzednim snapshotem: nowe <code>store_id</code> to sklep otwarty, zniknięte - zamknięty. Wynik zapisujemy jako historia zmian.",
    meth_etl_step5: "<strong>Zapis do bazy.</strong> Zapis do DuckDB. Nowe kolumny dodajemy przez <code>ALTER TABLE ADD COLUMN IF NOT EXISTS</code> (bez DEFAULT, bo DuckDB nie obsługuje DEFAULT w ALTER). Baza przechowuje ostatnie 6 miesięcy snapshotów - starsze usuwamy.",
    meth_etl_step6: "<strong>Czyszczenie cache.</strong> Po udanym ETL czyścimy cache Redis. Backend odbudowuje odpowiedzi na następnym zapytaniu. Redis jest opcjonalny - jak niedostępny, backend działa bez niego.",
    meth_sec_warn: "Czego nie gwarantujemy",
    meth_warn_title: "Ograniczenia danych",
    meth_warn_item1: "Około {{STAT_UNDATED_STORES}} sklepów nie ma daty otwarcia w źródłach - nie pojawiają się na wykresie historii wzrostu.",
    meth_warn_item2: "Populacje powiatów to dane roczne z GUS, nie bieżące szacunki.",
    meth_warn_item3: "Sklepy na granicach uproszczonych poligonów mogą trafić do sąsiedniego województwa (dotyczy około 3 punktów).",
    meth_warn_item4: "Godziny otwarcia pochodzą ze źródła Żabki, nie z weryfikacji terenowej.",
    meth_warn_item5: "Dane pogodowe są live - mogą różnić się od off-line bazy.",
    meth_warn_item6: "Obserwacje GBIF zależą od aktywności obserwatorów - mniej zamieszkałe regiony mają mniej rekordów nie dlatego, że jest mniej płazów, tylko dlatego, że mniej osób tam patrzy.",
    meth_warn_item7: "Brakujące źródło wzbogacenia zostawia kolumnę NULL - tabela jest spójna, ale niekompletna.",
    meth_warn_item8: "Soft delete: sklepy, które zniknęły ze źródła, dostają <code>deleted_at</code> w bazie. Zapytania domyślnie filtrują <code>deleted_at IS NULL</code>, więc zamknięte sklepy nie psują statystyk.",
    meth_foot_back: "Zbudowane z danych publicznych. <a href=\"/\" class=\"foot-link\">Powrót na dashboard</a>",

    // Atlas of Extremes (Kraniec) facts
    kr_cap_default: "Kliknij zjawisko – mapa doleci i podświetli kropki.",
    unit_store_singular: "sklep",
    unit_store_plural: "sklepów",
    fact_grp_compass: "Kompas – cztery kierunki",
    fact_grp_elevation: "Wysokość – góra i dół",
    fact_grp_isolation: "Izolacja – samotnik",
    fact_grp_history: "Historia sieci",
    fact_grp_void: "Pustka – biała plama",
    fact_grp_frog: "Żabka a żabki",
    fact_grp_h24: "24/7",
    fact_grp_nature: "Na łonie natury",
    fact_grp_twins: "Tuż obok siebie",
    fact_grp_nogap: "Miasta bez Żabki",
    fact_desc_nogap: "{city} - {pop} mieszkańców i ani jednej Żabki. Cała gmina bez sklepu albo sklep w sąsiedniej miejscowości.",
    fact_lab_north: "Najdalej na północ",
    fact_lab_south: "Najdalej na południe",
    fact_lab_east: "Najdalej na wschód",
    fact_lab_west: "Najdalej na zachód",
    fact_lab_highest: "Najwyżej n.p.m.",
    fact_lab_lowest: "Poniżej morza",
    fact_lab_isolated: "Najdalej od sąsiadki",
    fact_lab_oldest: "Najstarsza wciąż czynna",
    fact_lab_void: "Największa pustka",
    fact_lab_crown: "Korona kolekcji",
    fact_lab_frogrecord: "Rekord płazów",
    fact_lab_farfrog: "Najdalej od żaby",
    fact_lab_zerofrog: "Bez żadnej żaby w pobliżu",
    fact_lab_h24: "Sklepy całodobowe",
    fact_lab_parks: "W parkach i rezerwatach",
    fact_lab_twins: "Sklepy tuż obok siebie",
    fact_desc_north: "Najbardziej wysunięta na północ Żabka w kraju – tuż przy nadbałtyckim klifie.",
    fact_desc_south: "Kraniec południa: Cisna w Bieszczadach, brama w góry.",
    fact_desc_east: "Najbardziej na wschód – Hrubieszów, niemal przy granicy z Ukrainą.",
    fact_desc_west: "Skrajny zachód: Cedynia nad Odrą, kilka kilometrów od Niemiec.",
    fact_desc_highest: "Najwyżej położona Żabka w sieci.",
    fact_desc_lowest: "Jedyna Żabka poniżej poziomu morza.",
    fact_desc_isolated: "Najbardziej samotna Żabka w sieci.",
    fact_desc_oldest: "Najstarsza wciąż działająca Żabka w sieci. Otwarta w {year}, w sieci od {age} lat.",
    fact_desc_void: "Punkt w Bieszczadach oddalony o {distance} km od jakiejkolwiek Żabki – największa biała plama na mapie.",
    fact_desc_crown: "Żabka przy ulicy Zielonej Żabki.",
    fact_desc_frogrecord: "Najwięcej obserwacji płazów w promieniu 5 km ze wszystkich sklepów sieci.",
    fact_desc_farfrog: "Żabka najbardziej oddalona od najbliższej obserwacji płaza.",
    fact_desc_zerofrog: "Tyle sklepów nie ma ani jednej obserwacji płaza w promieniu 5 km (GBIF, Amphibia). Najbardziej odizolowana Żabka: {isolated_store} – {distance} km od najbliższej żaby.",
    fact_desc_zerofrog_simple: "Tyle sklepów nie ma ani jednej obserwacji płaza w promieniu 5 km (GBIF, Amphibia).",
    fact_desc_h24: "Żabki, które nigdy nie zamykają. Bardzo rzadkie w sieci – {count} na {total}.",
    fact_desc_parks: "Sklepy w parkach krajobrazowych i otulinach.",
    fact_desc_twins: "Przeciwieństwo samotnika: {count} sklepów ma inną Żabkę w promieniu 50 m.",
    fact_short_zerofrog: "sklepy bez obserwacji płaza w 5 km",
    fact_short_h24: "Żabki, które nigdy nie śpią",
    fact_short_parks: "Żabka w parku lub otulinie",
    fact_short_twins: "sieć dusi się od zagęszczenia",
    fact_val_zerofrog: "{count} sklepów",
    fact_val_twins: "{count} w 50 m",

    // i18n coverage audit additions
    meta_title: "Żabkozbiór – interaktywny atlas sieci w Polsce",
    meta_description: "Interaktywny atlas sieci Żabka: gdzie, kiedy i jak rosła sieć ponad 13 tysięcy sklepów. Mapy, rankingi, ekonomia i ciekawostki na danych publicznych.",
    og_description: "Gdzie, kiedy i jak rosła sieć ponad 13 tysięcy sklepów Żabka. Mapy, rankingi, ekonomia i ciekawostki na danych publicznych.",
    og_image_alt: "Interaktywny atlas sklepów Żabka w Polsce – ciemna mapa z lokalizacjami i wykresami",
    jsonld_website_desc: "Interaktywny atlas sieci Żabka w Polsce na danych publicznych.",
    jsonld_dataset_name: "Sieć Żabka w Polsce – lokalizacje i statystyki",
    jsonld_dataset_desc: "Dane o ponad 13 tysiącach sklepów Żabka w Polsce: lokalizacje, daty otwarcia, gęstość, godziny otwarcia oraz korelacje z danymi GUS, GBIF, InPost i GUGiK.",
    lang_toggle_aria: "Wybór języka",
    chart_growth_aria: "Wykres wzrostu sieci: słupki pokazują liczbę nowych sklepów w każdym roku 1998-2026, linia pokazuje zmianę rok do roku w procentach.",
    era_logo_1998_alt: "Logo Żabka 1998",
    era_logo_2020_alt: "Logo Żabka 2020",
    aria_admin_level: "Poziom administracyjny",
    aria_metric: "Metryka",
    aria_sort: "Sortowanie",
    aria_map_mode: "Tryb widoku mapy",
    aria_coverage_level: "Poziom pokrycia",
    aria_geo_level: "Poziom geograficzny",
    aria_distance_metric: "Metryka dystansu",
    aria_sort_results: "Sortowanie wyników",
    aria_gmina_metric: "Metryka gminy",
    chart_nbl_aria: "Wykres słupkowy: odległość do najbliższego sklepu wg wybranego poziomu geograficznego i metryki.",
    chart_knn_aria: "Histogram: rozkład odległości do najbliższego sklepu, mediana 299 m, średnia 942 m.",
    chart_elevation_aria: "Histogram: rozkład wysokości sklepów Żabka nad poziomem morza w Polsce, w kubełkach co 50 metrów.",
    chart_streets_aria: "Wykres słupkowy: ulice z największą liczbą sklepów Żabka w Polsce, z podaną nazwą ulicy i miasta.",
    chart_gmina_lead_aria: "Wykres słupkowy: gminy z największą liczbą sklepów na mieszkańca lub na km², wg wybranej metryki.",
    gran_dim_gmina: "Gminy",
    gran_word_gmina: "gmin",
    tab_load_error: "Nie udało się załadować danych tej zakładki. Sprawdź połączenie i spróbuj ponownie.",
    chart_empty: "Brak danych dla wybranych filtrów.",
    map_unavailable_default: "Mapa niedostępna",
    map_unavailable_hint: "Twoja przeglądarka nie udostępniła WebGL. Włącz akcelerację sprzętową w ustawieniach przeglądarki i odśwież stronę.",
    map_coop_win: "Użyj ctrl + scroll, aby przybliżyć mapę",
    map_coop_mac: "Użyj ⌘ + scroll, aby przybliżyć mapę",
    map_coop_mobile: "Przesuwaj dwoma palcami, aby przesunąć mapę",
    map_reset_view: "Reset widoku",
    map_reset_view_aria: "Resetuj widok mapy",
    map_growth_unavailable: "Mapa ekspansji niedostępna",
    map_voivodeship_unavailable: "Mapa województw niedostępna",
    map_inpost_unavailable: "Mapa Żabka vs InPost niedostępna",
    atlas_map_unavailable: "Atlas krańców niedostępny",
    fpf_tooltip_new: "Nowych:",
    fpf_tooltip_cursor: "Kursor:",
    fpf_tooltip_dominant_year: "dominanta ROKU:",
    chart_growth_xaxis: "Rok →",
    chart_growth_new_axis: "↑ Nowe sklepy",
    months_full: ["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca","sierpnia","września","października","listopada","grudnia"],
    months_initial: ["S","L","M","K","M","C","L","S","W","P","L","G"],
    map_tip_per1k_suffix: "/1k mieszk.",
    bucket_others: "Pozostałe",
    nbl_axis_meters: "metry do najbliższej Żabki",
    ratio_label: "stosunek",
    brand_zabka: "Żabka",
    nat_avg_prefix: "śr. kraj ",
    inpost_lockers_per_store_suffix: " paczkomaty na każdą Żabkę w Polsce",
    econ_tip_no_data: "brak danych ekonomicznych",
    econ_tip_avg_salary: "Średnia płaca:",
    econ_tip_unemployment: "Bezrobocie:",
    econ_tip_per1k: "Żabki / 1000 mieszk.:",
    econ_tip_denser: "gęściej",
    econ_tip_sparser: "rzadziej",
    econ_tip_trend_suffix: "{word} niż przewiduje trend ({resid})",
    econ_legend_below: "rzadziej niż trend",
    econ_legend_on: "zgodnie z trendem",
    econ_legend_above: "gęściej niż trend",
    no_data: "brak danych"
  },
};

let currentLang = 'pl'; // Polish default

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (translations[lang]) {
    currentLang = lang;
  }
}

export function t(key) {
  const v = translations[currentLang]?.[key] ?? translations['en']?.[key] ?? translations['pl']?.[key] ?? key;
  if (typeof v !== 'string') return v;
  let txt = v;
  if (M && M.summary) {
    txt = txt.replace(/\{\{([^}]+)\}\}/g, (match, token) => {
      const field = token.toLowerCase().replace(/^stat_/, '');
      const val = M.summary[field];
      if (val !== undefined && val !== null) {
        if (field === 'total_stores_words') {
          return currentLang === 'en' ? 'thirteen thousand' : 'trzynaście tysięcy';
        }
        if (field === 'date_modified') {
          return val.slice(0, 10);
        }
        if (typeof val === 'number') {
          const loc = currentLang === 'en' ? 'en-US' : 'pl-PL';
          const dec = val % 1 === 0 ? 0 : (val.toString().split('.')[1] || '').length;
          return val.toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });
        }
        return val;
      }
      // Unresolved placeholder - either a typo in the {{...}} token, a missing
      // key in stats_compiler.compile_live_stats(), or a page that forgot to
      // load M.summary before translating. Warn so it surfaces in the console
      // instead of silently rendering as literal {{TOKEN}}.
      if (typeof console !== 'undefined') {
        console.warn(`i18n: unresolved placeholder {{${token}}} for key "${key}" (M.summary.${field} is ${val === undefined ? 'undefined' : 'null'})`);
      }
      return match;
    });
  }
  return txt;
}

function updateJsonLd() {
  const script = document.getElementById('jsonld-main');
  if (!script) return;
  let data;
  try { data = JSON.parse(script.textContent); } catch (e) { return; }
  const lang = getLang() === 'en' ? 'en' : 'pl-PL';
  (data['@graph'] || []).forEach(node => {
    if (node['@type'] === 'WebSite') {
      node.description = t('jsonld_website_desc');
      node.inLanguage = lang;
    } else if (node['@type'] === 'Dataset') {
      node.name = t('jsonld_dataset_name');
      node.description = t('jsonld_dataset_desc');
      node.inLanguage = lang;
    }
  });
  script.textContent = JSON.stringify(data, null, 2);
}

export function translateDOM() {
  const lang = getLang();
  document.documentElement.lang = lang;
  document.title = t('meta_title');
  updateJsonLd();

  // Update active status on lang switcher buttons
  document.querySelectorAll('#lang-toggle .lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
  });

  // Translate elements with data-t (innerHTML content)
  document.querySelectorAll('[data-t]').forEach(el => {
    const key = el.getAttribute('data-t');
    const txt = t(key);
    
    // special handling to preserve brand-dot span
    if (key === 'brand_title') {
      const dot = el.querySelector('.brand-dot');
      el.textContent = '';
      if (dot) el.appendChild(dot);
      el.appendChild(document.createTextNode(txt));
    } else {
      el.innerHTML = txt;
    }
  });

  // Translate elements with data-t-aria (aria-label attribute)
  document.querySelectorAll('[data-t-aria]').forEach(el => {
    const key = el.getAttribute('data-t-aria');
    el.setAttribute('aria-label', t(key));
  });

  // Translate elements with data-t-placeholder (placeholder attribute)
  document.querySelectorAll('[data-t-placeholder]').forEach(el => {
    const key = el.getAttribute('data-t-placeholder');
    el.placeholder = t(key);
  });

  // Translate elements with data-t-title (title attribute)
  document.querySelectorAll('[data-t-title]').forEach(el => {
    const key = el.getAttribute('data-t-title');
    el.title = t(key);
  });

  // Translate elements with data-t-content (content attribute, e.g. meta tags)
  document.querySelectorAll('[data-t-content]').forEach(el => {
    const key = el.getAttribute('data-t-content');
    el.setAttribute('content', t(key));
  });

  // Translate elements with data-t-alt (alt attribute, e.g. logo images)
  document.querySelectorAll('[data-t-alt]').forEach(el => {
    const key = el.getAttribute('data-t-alt');
    el.setAttribute('alt', t(key));
  });
}
