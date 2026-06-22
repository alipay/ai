EXPENSE_TYPE_METRO = "METRO"
SCENE_TYPE_TRAVEL = "TRAVEL"
RULE_FACTOR_CARD_TYPE = "CARD_TYPE"
RULE_FACTOR_QUOTA_TOTAL = "QUOTA_TOTAL"


def create_metro_institution():
    return {
        "method": "alipay.ebpp.invoice.institution.create",
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
                {"rule_factor": RULE_FACTOR_CARD_TYPE, "rule_value": []},
                {"rule_factor": RULE_FACTOR_QUOTA_TOTAL, "rule_value": "100000"},
            ],
        }],
    }
