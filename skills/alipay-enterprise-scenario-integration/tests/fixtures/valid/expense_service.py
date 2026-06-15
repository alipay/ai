EXPENSE_TYPE_TICKET = "TICKET"
SCENE_TYPE_TRAVEL = "TRAVEL"
RULE_FACTOR_MERCHANT = "MERCHANT"
RULE_FACTOR_QUOTA_TOTAL = "QUOTA_TOTAL"
RULE_VALUE_MERCHANT_12306 = "{\"2088011519249952\":[\"-1\"]}"


def create_train_ticket_institution():
    return {
        "method": "alipay.ebpp.invoice.institution.create",
        "consult_mode": "0",
        "standard_info_list": [{
            "expense_type": EXPENSE_TYPE_TICKET,
            "expense_type_sub_category": EXPENSE_TYPE_TICKET,
            "scene_type": SCENE_TYPE_TRAVEL,
            "standard_condition_info_list": [
                {"rule_factor": RULE_FACTOR_MERCHANT, "rule_value": RULE_VALUE_MERCHANT_12306},
                {"rule_factor": RULE_FACTOR_QUOTA_TOTAL, "rule_value": "100000"},
            ],
        }],
    }
