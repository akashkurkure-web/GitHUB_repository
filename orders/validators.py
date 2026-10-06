import os
import struct

from django.conf import settings
from django.core.exceptions import ValidationError

MODEL_EXTENSIONS = {".stl", ".obj", ".3mf", ".step", ".stp", ".iges", ".igs"}
DRAWING_EXTENSIONS = {".pdf", ".dxf", ".dwg", ".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_EXTENSIONS = MODEL_EXTENSIONS | DRAWING_EXTENSIONS


def file_kind(name):
    ext = os.path.splitext(name)[1].lower()
    if ext in MODEL_EXTENSIONS:
        return "model"
    if ext in DRAWING_EXTENSIONS:
        return "drawing"
    return "other"


def _check_stl(upload):
    """Reject files that claim to be STL but are neither ASCII nor binary STL."""
    upload.seek(0)
    head = upload.read(84)
    upload.seek(0)
    if head[:5].lower() == b"solid":
        return
    if len(head) < 84:
        raise ValidationError("This STL file is too small to contain a 3D model.")
    triangles = struct.unpack("<I", head[80:84])[0]
    if triangles == 0 or 84 + triangles * 50 != upload.size:
        raise ValidationError("This file does not look like a valid STL model. Please re-export it from your CAD tool.")


def validate_design_file(upload):
    ext = os.path.splitext(upload.name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(e.lstrip(".").upper() for e in ALLOWED_EXTENSIONS))
        raise ValidationError(f"'{upload.name}': file type not supported. Allowed: {allowed}.")
    if upload.size == 0:
        raise ValidationError(f"'{upload.name}' is empty.")
    if upload.size > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise ValidationError(f"'{upload.name}' is larger than {settings.MAX_UPLOAD_MB:g} MB. "
                              "Please share it as a link (Google Drive, Dropbox or WeTransfer) instead.")
    if ext == ".stl":
        _check_stl(upload)


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def validate_image(upload, max_mb=None):
    ext = os.path.splitext(upload.name)[1].lower()
    if ext not in IMAGE_EXTENSIONS | {".pdf"}:
        raise ValidationError("Upload a JPG, PNG, WEBP or PDF file.")
    limit = max_mb or settings.MAX_UPLOAD_MB
    if upload.size > limit * 1024 * 1024:
        raise ValidationError(f"The file is larger than {limit:g} MB.")
