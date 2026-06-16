EXPENSE_TYPE_METRO = "METRO"
SCENE_TYPE_TRAVEL = "TRAVEL"
RULE_FACTOR_CARD_TYPE = "CARD_TYPE"
RULE_FACTOR_QUOTA_TOTAL = "QUOTA_TOTAL"
RULE_VALUE_CARD_TYPE = "[\"S0110000\"]"


def create_metro_institution():
    return {
        "method": "alipay.ebpp.invoice.institution.create",
        "consult_mode": "0",
        "standard_info_list": [{
            "expense_type": EXPENSE_TYPE_METRO,
            "expense_type_sub_category": EXPENSE_TYPE_METRO,
            "scene_type": SCENE_TYPE_TRAVEL,
            "standard_condition_info_list": [
                {"rule_factor": RULE_FACTOR_CARD_TYPE, "rule_value": RULE_VALUE_CARD_TYPE},
                {"rule_factor": RULE_FACTOR_QUOTA_TOTAL, "rule_value": "100000"},
            ],
        }],
    }
