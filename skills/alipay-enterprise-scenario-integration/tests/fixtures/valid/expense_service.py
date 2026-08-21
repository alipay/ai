EXPENSE_TYPE_METRO = "METRO"
from ecs_marker import build_ecs_outer_source_id


SCENE_TYPE_TRAVEL = "TRAVEL"
RULE_FACTOR_CARD_TYPE = "CARD_TYPE"
RULE_FACTOR_QUOTA_TOTAL = "QUOTA_TOTAL"
RULE_CONFIG_STORE = {}


def validate_card_type(card_type):
    documented_card_type_enum = load_documented_card_type_enum()
    if card_type not in documented_card_type_enum:
        raise ValueError("CARD_TYPE is outside the documented enum")


def save_rule_factor_config(enterprise_id, card_type):
    validate_card_type(card_type)
    RULE_CONFIG_STORE[enterprise_id] = {RULE_FACTOR_CARD_TYPE: [card_type]}


def load_rule_factor_config(enterprise_id):
    return RULE_CONFIG_STORE[enterprise_id]


def create_metro_institution(app_id, enterprise_id, provider_institution_id):
    rule_factor_config = load_rule_factor_config(enterprise_id)
    validate_card_type(rule_factor_config[RULE_FACTOR_CARD_TYPE][0])
    return {
        "method": "alipay.ebpp.invoice.institution.create",
        "outer_source_id": build_ecs_outer_source_id(app_id, enterprise_id, provider_institution_id),
        "consult_mode": "0",
        "issue_rule_info_list": [{
            "issue_rule_name": "默认发放规则",
            "outer_source_id": "metro-default-issue-rule",
        }],
        "standard_info_list": [{
            "expense_type": EXPENSE_TYPE_METRO,
            "expense_type_sub_category": EXPENSE_TYPE_METRO,
            "scene_type": SCENE_TYPE_TRAVEL,
            "standard_condition_info_list": [
                {"rule_factor": RULE_FACTOR_CARD_TYPE, "rule_value": rule_factor_config[RULE_FACTOR_CARD_TYPE]},
                {"rule_factor": RULE_FACTOR_QUOTA_TOTAL, "rule_value": "100000"},
            ],
        }],
    }
