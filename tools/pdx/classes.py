"""Class vocabularies, shared with the runtime through the manifest.

The baker writes an INDEX; the manifest writes the NAME at that index; the
runtime maps names to colours and models. That seam is deliberate -- data
belongs to the bake, look belongs to the game, and retuning a palette must
never mean re-baking a city.
"""

BUILDING = ["house","detached","garage","outbuilding","apartments","residential",
            "commercial","retail","office","industrial","warehouse","civic",
            "education","religious","medical","hotel","parking","transit",
            "tower","other"]

ROAD = ["motorway","trunk","primary","secondary","tertiary","residential",
        "unclassified","living_street","service","driveway","parking_aisle",
        "alley","pedestrian","footway","sidewalk","crosswalk","steps","path",
        "cycleway","track","rail","unknown"]

# Carriageway width in metres when the data does not carry one. These are the
# numbers the collider and the kerb line both read, so a change here moves the
# pavement and the street trees together.
ROAD_WIDTH = {"motorway":14.0,"trunk":12.0,"primary":12.0,"secondary":10.5,
              "tertiary":9.0,"residential":8.0,"unclassified":7.0,
              "living_street":6.5,"service":5.0,"driveway":3.0,
              "parking_aisle":5.0,"alley":4.0,"pedestrian":6.0,"footway":1.8,
              "sidewalk":2.0,"crosswalk":3.2,"steps":1.8,"path":1.4,
              "cycleway":2.4,"track":3.0,"rail":3.0,"unknown":6.0}

# Which classes get street furniture generated along them, and how eagerly.
# A motorway with a row of benches beside it is worse than a bare motorway.
STREETSCAPE = {"primary":1.0,"secondary":1.0,"tertiary":1.0,"residential":1.0,
               "unclassified":0.8,"living_street":0.8,"pedestrian":0.6}

AREA = ["water","river","pond","park","grass","forest","scrub","garden","pitch",
        "playground","sand","plaza","parking","school","religious","cemetery",
        "brownfield","construction","residential_lu","retail_lu","commercial_lu",
        "industrial_lu","wetland","railway","track"]

PROP = ["tree","tree_conifer","street_lamp","traffic_signal","stop_sign","bench",
        "hydrant","bin","bollard","bus_stop","post_box","drinking_fountain",
        "power_pole","artwork","bike_rack","planter","billboard","parking_meter",
        "newspaper_box","picnic_table","flagpole","fountain","car"]

# Where cars park, and how full the kerb is. A motorway has no kerb parking and
# a footway has no cars at all; putting a row of parked cars down either is the
# same class of wrong as a tree in the carriageway.
PARKING = {"residential": 0.62, "tertiary": 0.46, "secondary": 0.34,
           "unclassified": 0.52, "living_street": 0.55, "service": 0.22,
           "primary": 0.18}

BI = {n: i for i, n in enumerate(BUILDING)}
RI = {n: i for i, n in enumerate(ROAD)}
AI = {n: i for i, n in enumerate(AREA)}
PI = {n: i for i, n in enumerate(PROP)}

def building_class(cls, subtype, height):
    """Overture's class/subtype -> our palette bucket."""
    c, s = (cls or ""), (subtype or "")
    if c in BI: return BI[c]
    if c in ("apartments",): return BI["apartments"]
    if c in ("detached","semidetached_house","terrace","bungalow","static_caravan"):
        return BI["detached" if c == "detached" else "house"]
    if c in ("garage","garages","carport","shed","hut","roof"): return BI["garage"]
    if c in ("supermarket","kiosk","shop","mall"): return BI["retail"]
    if c in ("warehouse","factory","manufacture"): return BI["warehouse"]
    if c in ("church","chapel","cathedral","mosque","synagogue","temple"): return BI["religious"]
    if c in ("school","university","college","kindergarten"): return BI["education"]
    if c in ("hospital","clinic"): return BI["medical"]
    if c in ("hotel","motel","hostel"): return BI["hotel"]
    if c in ("parking",): return BI["parking"]
    if c in ("train_station","transportation"): return BI["transit"]
    if s == "commercial":  return BI["office"] if (height or 0) >= 24 else BI["commercial"]
    if s == "industrial":  return BI["industrial"]
    if s == "education":   return BI["education"]
    if s == "religious":   return BI["religious"]
    if s == "medical":     return BI["medical"]
    if s == "civic" or s == "service": return BI["civic"]
    if s == "transportation": return BI["transit"]
    if s == "outbuilding": return BI["outbuilding"]
    if s == "residential":
        return BI["apartments"] if (height or 0) >= 14 else BI["house"]
    if (height or 0) >= 60: return BI["tower"]
    return BI["other"]

# Typical storey height, and a fallback height when the data has neither a
# height nor a floor count. A garage guessed at 9 m ruins a whole block.
FALLBACK_H = {"house":6.5,"detached":6.5,"garage":3.0,"outbuilding":3.2,
              "apartments":13.0,"residential":9.0,"commercial":9.0,"retail":7.0,
              "office":22.0,"industrial":9.5,"warehouse":9.5,"civic":11.0,
              "education":10.0,"religious":11.0,"medical":14.0,"hotel":18.0,
              "parking":11.0,"transit":8.0,"tower":60.0,"other":7.0}

# 0 flat, 1 pitched. Portland's residential stock is overwhelmingly pitched and
# its commercial core is overwhelmingly flat; getting that split right is most
# of what makes a neighbourhood read as a neighbourhood.
PITCHED = {"house","detached","garage","outbuilding","religious","education"}

def area_class(cls, subtype):
    c, s = (cls or ""), (subtype or "")
    direct = {"river":"river","water":"water","pond":"pond","stream":"river",
              "swimming_pool":"pond","park":"park","grass":"grass","meadow":"grass",
              "forest":"forest","wood":"forest","tree":"forest","tree_row":"forest",
              "scrub":"scrub","shrubbery":"scrub","shrub":"scrub","heath":"scrub",
              "garden":"garden","pitch":"pitch","playground":"playground",
              "beach":"sand","sand":"sand","pedestrian":"plaza","plaza":"plaza",
              "parking":"parking","school":"school","religious":"religious",
              "cemetery":"cemetery","grave_yard":"cemetery","brownfield":"brownfield",
              "construction":"construction","residential":"residential_lu",
              "retail":"retail_lu","commercial":"commercial_lu",
              "industrial":"industrial_lu","wetland":"wetland","railway":"railway",
              "track":"track"}
    for k in (c, s):
        if k in direct: return AI[direct[k]]
    return None
