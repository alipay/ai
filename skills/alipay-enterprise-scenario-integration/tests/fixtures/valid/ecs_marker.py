import hashlib


def build_ecs_outer_source_id(app_id, enterprise_id, provider_institution_id):
    raw = "\0".join((app_id, enterprise_id, provider_institution_id))
    return "ECS_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:60]
