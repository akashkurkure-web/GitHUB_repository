"""Shared vocabularies used by products, orders and the vendor."""

SEGMENTS = [
    ("mass", "Mass manufacturing"),
    ("custom", "Custom jobs"),
    ("decor", "Home decor"),
    ("medical", "Medical models"),
]

SEGMENT_INFO = {
    "mass": {
        "icon": "boxes",
        "title": "Mass manufacturing",
        "blurb": "Batch production of parts, jigs, fixtures and enclosures, from 50 to thousands of pieces.",
        "points": ["Volume pricing per piece", "Consistent quality across batches", "Advance-based production slots"],
    },
    "custom": {
        "icon": "rulers",
        "title": "Custom jobs",
        "blurb": "Send us your STL, STEP or a drawing. We quote, print and deliver one-off parts and prototypes.",
        "points": ["Engineering review of every file", "Quote in 1 working day", "Prototypes and functional parts"],
    },
    "decor": {
        "icon": "lamp",
        "title": "Home decor",
        "blurb": "Ready designs for lamps, planters, idols, name plates and gifts, printed to order.",
        "points": ["Fixed prices, order online", "Personalisation on request", "Gift-ready packing"],
    },
    "medical": {
        "icon": "heart-pulse",
        "title": "Medical models",
        "blurb": "Anatomical and surgical-planning models, training aids and prototypes for clinics and labs.",
        "points": ["Enquiry and consultation first", "Confidential handling of files", "Not for use inside the body"],
    },
}

TECHNOLOGIES = [
    ("FDM", "FDM (filament)"),
    ("SLA", "SLA (resin)"),
    ("SLS", "SLS (nylon powder)"),
    ("MJF", "MJF (multi jet fusion)"),
]

MATERIALS = [
    ("PLA", "PLA"),
    ("ABS", "ABS"),
    ("PETG", "PETG"),
    ("TPU", "TPU (flexible)"),
    ("NYLON", "Nylon PA12"),
    ("RESIN_STD", "Standard resin"),
    ("RESIN_TOUGH", "Tough resin"),
    ("OTHER", "Other / advise me"),
]

FINISHES = [
    ("raw", "As printed"),
    ("sanded", "Sanded / smoothed"),
    ("primed", "Primed"),
    ("painted", "Painted"),
]

INDIAN_STATES = [
    "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh",
    "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
    "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry",
    "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
    "West Bengal",
]
STATE_CHOICES = [(s, s) for s in INDIAN_STATES]
