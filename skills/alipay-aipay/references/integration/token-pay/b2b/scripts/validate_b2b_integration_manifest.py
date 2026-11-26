#!/usr/bin/env python3
"""Validate an evidence-backed Enterprise Payment integration manifest."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


ALLOWED_FLOWS = {
    "AGGREGATE_CASHIER",
    "ALIPAY_PC",
    "ALIPAY_APP",
    "BANK_TRANSFER",
    "ENTERPRISE_EBANK",
    "BANK_TRANSFER_DIRECT",
}
ALLOWED_CLIENT_MODES = {"OFFICIAL_SDK", "DIRECT_GATEWAY"}
ALLOWED_PROTOCOLS = {"CLASSIC_GATEWAY_V2"}
ALLOWED_SECURITY_MODES = {"PUBLIC_KEY", "CERTIFICATE"}
ALLOWED_CAPABILITIES = {
    "ACCOUNT_MANAGEMENT",
    "JIANGSU_BANK_ACCOUNT_OPENING",
    "TRADE_CLOSE",
    "REFUND",
    "PARTIAL_REFUND",
    "REFUND_DETAIL_QUERY",
    "BILL_DOWNLOAD",
    "EBANK_CONSULT",
    "BANK_FUND_CONFIRMATION",
}
ALLOWED_EVIDENCE_KINDS = {"file", "test", "run", "external"}
ALLOWED_RUN_ENVIRONMENTS = {"sandbox", "dev", "test", "pre"}
LANGUAGE_PATTERN = re.compile(r"^[a-z][a-z0-9.+#_-]{0,31}$")
FORBIDDEN_SECRET_KEYS = {
    "private_key",
    "app_private_key",
    "client_secret",
    "password",
    "access_token",
    "auth_token",
    "bank_merchant_no",
    "bank_master_account_no",
    "bank_account_name",
    "bank_routing_no",
}


@dataclass(frozen=True)
class Profile:
    language: str
    client_mode: str
    protocol: str
    security_mode: str
    flows: frozenset[str]
    capabilities: frozenset[str]


@dataclass(frozen=True)
class Requirement:
    requirement_id: str
    title: str
    condition: Callable[[Profile], bool]
    allowed_kinds: frozenset[str] | None = None


def always_required(_profile: Profile) -> bool:
    """Return true for requirements shared by every integration profile."""

    return True


def official_sdk_required(profile: Profile) -> bool:
    return profile.client_mode == "OFFICIAL_SDK"


def direct_gateway_required(profile: Profile) -> bool:
    return profile.client_mode == "DIRECT_GATEWAY"


def certificate_mode_required(profile: Profile) -> bool:
    return profile.security_mode == "CERTIFICATE"


REQUIREMENTS = (
    Requirement(
        "product_activation",
        "产品签约",
        always_required,
        frozenset({"external", "run"}),
    ),
    Requirement(
        "merchant_application_readiness",
        "商户自研应用准备",
        always_required,
        frozenset({"external", "run"}),
    ),
    Requirement(
        "open_platform_configuration",
        "开放平台身份与安全配置",
        always_required,
        frozenset({"external", "run"}),
    ),
    Requirement("official_sdk", "官方 SDK", official_sdk_required),
    Requirement(
        "language_build_and_test",
        "目标语言构建与测试",
        always_required,
        frozenset({"test", "run"}),
    ),
    Requirement(
        "direct_gateway_request_signing",
        "非 SDK 请求规范化与 RSA2 签名",
        direct_gateway_required,
        frozenset({"test", "run"}),
    ),
    Requirement(
        "direct_gateway_response_verification",
        "非 SDK 原始响应验签",
        direct_gateway_required,
        frozenset({"test", "run"}),
    ),
    Requirement(
        "direct_gateway_transport",
        "非 SDK HTTP 传输边界",
        direct_gateway_required,
        frozenset({"test", "run"}),
    ),
    Requirement(
        "certificate_mode",
        "证书模式与证书序列号",
        certificate_mode_required,
        frozenset({"test", "run"}),
    ),
    Requirement("rsa2_security", "RSA2 签名与响应验签", always_required),
    Requirement("secret_management", "密钥安全管理", always_required),
    Requirement("contract_models", "接口契约模型", always_required),
    Requirement("trade_create", "收款单创建", always_required),
    Requirement("create_idempotency", "创单幂等", always_required),
    Requirement("trade_query", "交易查询", always_required),
    Requirement("payment_finality", "支付终态确认", always_required),
    Requirement(
        "openmq_subscription",
        "OpenMQ 订阅",
        always_required,
        frozenset({"external", "run"}),
    ),
    Requirement(
        "openmq_method_routing",
        "OpenMQ method 路由",
        always_required,
        frozenset({"test", "run"}),
    ),
    Requirement("openmq_idempotency", "OpenMQ 幂等", always_required),
    Requirement("openmq_ack_and_recovery", "OpenMQ ACK 与恢复", always_required),
    Requirement("error_and_unknown_result", "错误分类与未知结果恢复", always_required),
    Requirement("observability_and_redaction", "可观测性与脱敏", always_required),
    Requirement("status_reconciliation", "主动查询补偿", always_required),
    Requirement(
        "non_production_e2e",
        "非生产端到端联调",
        always_required,
        frozenset({"run"}),
    ),
    Requirement(
        "aggregate_cashier_redirect",
        "聚合收银台跳转",
        lambda profile: "AGGREGATE_CASHIER" in profile.flows,
    ),
    Requirement(
        "bank_transfer_direct_create",
        "银行转账单通创单",
        lambda profile: "BANK_TRANSFER_DIRECT" in profile.flows,
    ),
    Requirement(
        "alipay_terminal_payment",
        "支付宝终端支付",
        lambda profile: bool({"ALIPAY_PC", "ALIPAY_APP"} & profile.flows),
    ),
    Requirement(
        "bank_transfer_aggregate",
        "银行转账聚合收银与专属账户",
        lambda profile: "BANK_TRANSFER" in profile.flows,
    ),
    Requirement(
        "enterprise_ebank_payment",
        "企业网银支付",
        lambda profile: "ENTERPRISE_EBANK" in profile.flows,
    ),
    Requirement(
        "ebank_consult",
        "企业网银机构咨询",
        lambda profile: "EBANK_CONSULT" in profile.capabilities,
    ),
    Requirement(
        "fund_openmq_subscription",
        "待认款资金 OpenMQ 订阅",
        lambda profile: "BANK_FUND_CONFIRMATION" in profile.capabilities,
        frozenset({"external", "run"}),
    ),
    Requirement(
        "fund_message_routing",
        "订单与资金消息分流",
        lambda profile: "BANK_FUND_CONFIRMATION" in profile.capabilities,
        frozenset({"test", "run"}),
    ),
    Requirement(
        "fund_confirmation",
        "资金确认与拒绝",
        lambda profile: "BANK_FUND_CONFIRMATION" in profile.capabilities,
    ),
    Requirement(
        "fund_idempotency_and_concurrency",
        "资金幂等与并发控制",
        lambda profile: "BANK_FUND_CONFIRMATION" in profile.capabilities,
        frozenset({"test", "run"}),
    ),
    Requirement(
        "account_create",
        "银行账户创建",
        lambda profile: "ACCOUNT_MANAGEMENT" in profile.capabilities,
    ),
    Requirement(
        "account_query",
        "银行账户查询",
        lambda profile: "ACCOUNT_MANAGEMENT" in profile.capabilities,
    ),
    Requirement(
        "jiangsu_bank_account_opening_info",
        "江苏银行开户资料交接",
        lambda profile: "JIANGSU_BANK_ACCOUNT_OPENING" in profile.capabilities,
        frozenset({"external", "run"}),
    ),
    Requirement(
        "trade_close",
        "交易关单",
        lambda profile: "TRADE_CLOSE" in profile.capabilities,
    ),
    Requirement(
        "refund",
        "交易退款",
        lambda profile: "REFUND" in profile.capabilities,
    ),
    Requirement(
        "refund_query",
        "退款查询",
        lambda profile: "REFUND" in profile.capabilities,
    ),
    Requirement(
        "partial_refund_idempotency",
        "部分退款幂等",
        lambda profile: "PARTIAL_REFUND" in profile.capabilities,
    ),
    Requirement(
        "refund_detail_options",
        "退款明细选项",
        lambda profile: "REFUND_DETAIL_QUERY" in profile.capabilities,
    ),
    Requirement(
        "bill_download",
        "账单下载",
        lambda profile: "BILL_DOWNLOAD" in profile.capabilities,
    ),
    Requirement(
        "financial_reconciliation",
        "资金对账",
        lambda profile: "BILL_DOWNLOAD" in profile.capabilities,
    ),
    Requirement(
        "bill_download_e2e",
        "账单下载非生产联调",
        lambda profile: "BILL_DOWNLOAD" in profile.capabilities,
        frozenset({"run"}),
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="校验企业支付集成画像、证据声明和证据文件。"
    )
    parser.add_argument("--manifest", required=True, type=Path, help="集成清单 JSON")
    parser.add_argument(
        "--project-root", type=Path, default=Path.cwd(), help="商户工程根目录"
    )
    parser.add_argument(
        "--structural-only",
        action="store_true",
        help="只校验结构，不检查证据路径；不能用于最终验收",
    )
    parser.add_argument(
        "--format", choices=("text", "json"), default="text", help="输出格式"
    )
    return parser.parse_args()


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"清单不存在: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"清单不是合法 JSON: line={exc.lineno}, column={exc.colno}") from exc
    if not isinstance(data, dict):
        raise ValueError("清单顶层必须是 object")
    return data


def validate_no_secrets(value: Any, path: str, errors: list[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            key_text = str(key)
            if key_text.lower() in FORBIDDEN_SECRET_KEYS:
                errors.append(f"{path}.{key_text}: 清单禁止包含凭证字段")
            validate_no_secrets(child, f"{path}.{key_text}", errors)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            validate_no_secrets(child, f"{path}[{index}]", errors)
    elif isinstance(value, str) and "-----BEGIN" in value.upper():
        errors.append(f"{path}: 清单禁止包含 PEM 或私钥内容")


def string_set(
    raw: Any, field: str, allowed: set[str], errors: list[str]
) -> frozenset[str]:
    if not isinstance(raw, list) or not raw:
        errors.append(f"{field}: 必须是非空字符串数组")
        return frozenset()
    if not all(isinstance(item, str) and item for item in raw):
        errors.append(f"{field}: 只能包含非空字符串")
        return frozenset()
    values = frozenset(raw)
    if len(values) != len(raw):
        errors.append(f"{field}: 不允许重复值")
    unknown = sorted(values - allowed)
    if unknown:
        errors.append(f"{field}: 不支持 {', '.join(unknown)}")
    return values


def enum_string(raw: Any, field: str, allowed: set[str], errors: list[str]) -> str:
    if not isinstance(raw, str) or not raw:
        errors.append(f"{field}: 必须是非空字符串")
        return ""
    if raw not in allowed:
        errors.append(f"{field}: 只能是 {', '.join(sorted(allowed))} 之一")
    return raw


def parse_profile(raw: Any, errors: list[str]) -> Profile:
    if not isinstance(raw, dict):
        errors.append("profile: 必须是 object")
        return Profile("", "", "", "", frozenset(), frozenset())

    profile_keys = {
        "flows",
        "capabilities",
        "language",
        "client_mode",
        "protocol",
        "security_mode",
    }
    unknown_keys = sorted(set(raw) - profile_keys)
    if unknown_keys:
        errors.append(f"profile: 未知字段 {', '.join(unknown_keys)}")

    language = raw.get("language")
    if not isinstance(language, str) or not LANGUAGE_PATTERN.fullmatch(language):
        errors.append(
            "profile.language: 必须是小写语言名，且匹配 "
            "^[a-z][a-z0-9.+#_-]{0,31}$"
        )
        language = ""
    client_mode = enum_string(
        raw.get("client_mode"),
        "profile.client_mode",
        ALLOWED_CLIENT_MODES,
        errors,
    )
    protocol = enum_string(
        raw.get("protocol"),
        "profile.protocol",
        ALLOWED_PROTOCOLS,
        errors,
    )
    security_mode = enum_string(
        raw.get("security_mode"),
        "profile.security_mode",
        ALLOWED_SECURITY_MODES,
        errors,
    )

    flows = string_set(raw.get("flows"), "profile.flows", ALLOWED_FLOWS, errors)
    capabilities_raw = raw.get("capabilities", [])
    if not isinstance(capabilities_raw, list):
        errors.append("profile.capabilities: 必须是字符串数组")
        capabilities = frozenset()
    elif not capabilities_raw:
        capabilities = frozenset()
    else:
        capabilities = string_set(
            capabilities_raw, "profile.capabilities", ALLOWED_CAPABILITIES, errors
        )

    if "PARTIAL_REFUND" in capabilities and "REFUND" not in capabilities:
        errors.append("profile: PARTIAL_REFUND 依赖 REFUND")
    if "REFUND_DETAIL_QUERY" in capabilities and "REFUND" not in capabilities:
        errors.append("profile: REFUND_DETAIL_QUERY 依赖 REFUND")
    aggregate_channels = {
        "ALIPAY_PC",
        "ALIPAY_APP",
        "BANK_TRANSFER",
        "ENTERPRISE_EBANK",
    }
    if aggregate_channels & flows and "AGGREGATE_CASHIER" not in flows:
        errors.append("profile: 支付渠道 flow 依赖 AGGREGATE_CASHIER")
    if (
        "ACCOUNT_MANAGEMENT" in capabilities
        and not {"BANK_TRANSFER", "BANK_TRANSFER_DIRECT"} & flows
    ):
        errors.append("profile: ACCOUNT_MANAGEMENT 依赖银行转账 flow")
    if (
        "JIANGSU_BANK_ACCOUNT_OPENING" in capabilities
        and not {"BANK_TRANSFER", "BANK_TRANSFER_DIRECT"} & flows
    ):
        errors.append("profile: JIANGSU_BANK_ACCOUNT_OPENING 依赖银行转账 flow")
    if "EBANK_CONSULT" in capabilities and "ENTERPRISE_EBANK" not in flows:
        errors.append("profile: EBANK_CONSULT 依赖 ENTERPRISE_EBANK")
    if "BANK_FUND_CONFIRMATION" in capabilities and "BANK_TRANSFER" not in flows:
        errors.append("profile: BANK_FUND_CONFIRMATION 依赖 BANK_TRANSFER")
    return Profile(
        language,
        client_mode,
        protocol,
        security_mode,
        flows,
        capabilities,
    )


def resolve_evidence_path(project_root: Path, raw_path: str) -> Path | None:
    relative = Path(raw_path)
    if relative.is_absolute():
        return None
    resolved = (project_root / relative).resolve()
    try:
        resolved.relative_to(project_root)
    except ValueError:
        return None
    return resolved


def validate_evidence_item(
    item: Any,
    requirement: Requirement,
    index: int,
    project_root: Path,
    structural_only: bool,
) -> list[str]:
    prefix = f"evidence.{requirement.requirement_id}[{index}]"
    errors: list[str] = []
    if not isinstance(item, dict):
        return [f"{prefix}: 必须是 object"]
    kind = item.get("kind")
    if kind not in ALLOWED_EVIDENCE_KINDS:
        return [f"{prefix}.kind: 必须是 {', '.join(sorted(ALLOWED_EVIDENCE_KINDS))} 之一"]
    if requirement.allowed_kinds and kind not in requirement.allowed_kinds:
        errors.append(
            f"{prefix}.kind: 该检查项只接受 "
            f"{', '.join(sorted(requirement.allowed_kinds))} 证据"
        )
    description = item.get("description")
    if not isinstance(description, str) or len(description.strip()) < 4:
        errors.append(f"{prefix}.description: 至少填写 4 个字符的证据说明")

    allowed_keys = {"kind", "description"}
    if kind in {"file", "test", "run"}:
        allowed_keys.add("path")
        raw_path = item.get("path")
        if not isinstance(raw_path, str) or not raw_path.strip():
            errors.append(f"{prefix}.path: 必须填写工程内相对路径")
        else:
            evidence_path = resolve_evidence_path(project_root, raw_path)
            if evidence_path is None:
                errors.append(f"{prefix}.path: 路径必须位于 project-root 内")
            elif not structural_only and not evidence_path.is_file():
                errors.append(f"{prefix}.path: 证据文件不存在: {raw_path}")
    if kind == "test":
        allowed_keys.add("case")
        if not isinstance(item.get("case"), str) or not item["case"].strip():
            errors.append(f"{prefix}.case: test 证据必须填写测试用例名")
    if kind == "run":
        allowed_keys.add("environment")
        if item.get("environment") not in ALLOWED_RUN_ENVIRONMENTS:
            errors.append(
                f"{prefix}.environment: 只能是 {', '.join(sorted(ALLOWED_RUN_ENVIRONMENTS))}"
            )
    if kind == "external":
        allowed_keys.add("reference")
        if not isinstance(item.get("reference"), str) or not item["reference"].strip():
            errors.append(f"{prefix}.reference: external 证据必须填写可追踪回执")
    unknown_keys = sorted(set(item) - allowed_keys)
    if unknown_keys:
        errors.append(f"{prefix}: 未知字段 {', '.join(unknown_keys)}")
    return errors


def validate_manifest(
    manifest: dict[str, Any], project_root: Path, structural_only: bool
) -> dict[str, Any]:
    errors: list[str] = []
    validate_no_secrets(manifest, "$", errors)
    unknown_top = sorted(set(manifest) - {"profile", "evidence"})
    if unknown_top:
        errors.append(f"顶层未知字段: {', '.join(unknown_top)}")

    profile = parse_profile(manifest.get("profile"), errors)
    evidence = manifest.get("evidence")
    if not isinstance(evidence, dict):
        errors.append("evidence: 必须是 object")
        evidence = {}

    requirement_ids = {item.requirement_id for item in REQUIREMENTS}
    unknown_evidence = sorted(set(evidence) - requirement_ids)
    if unknown_evidence:
        errors.append(f"evidence: 未知检查项 {', '.join(unknown_evidence)}")

    statuses: list[dict[str, str]] = []
    for requirement in REQUIREMENTS:
        if not requirement.condition(profile):
            statuses.append(
                {
                    "id": requirement.requirement_id,
                    "title": requirement.title,
                    "status": "SKIP",
                    "detail": "接入画像未触发",
                }
            )
            continue
        items = evidence.get(requirement.requirement_id)
        before_count = len(errors)
        if not isinstance(items, list) or not items:
            errors.append(f"evidence.{requirement.requirement_id}: 缺少非空证据数组")
        else:
            for index, item in enumerate(items):
                errors.extend(
                    validate_evidence_item(
                        item, requirement, index, project_root, structural_only
                    )
                )
        status = "PASS" if len(errors) == before_count else "FAIL"
        statuses.append(
            {
                "id": requirement.requirement_id,
                "title": requirement.title,
                "status": status,
                "detail": "证据有效" if status == "PASS" else "证据缺失或无效",
            }
        )

    required_count = sum(item["status"] != "SKIP" for item in statuses)
    passed_count = sum(item["status"] == "PASS" for item in statuses)
    skipped_count = sum(item["status"] == "SKIP" for item in statuses)
    return {
        "success": not errors,
        "mode": "structural-only" if structural_only else "evidence",
        "summary": {
            "required": required_count,
            "passed": passed_count,
            "failed": required_count - passed_count,
            "skipped": skipped_count,
            "errors": len(errors),
        },
        "requirements": statuses,
        "errors": errors,
    }


def print_text(result: dict[str, Any]) -> None:
    for item in result["requirements"]:
        print(f"[{item['status']}] {item['id']}: {item['title']} - {item['detail']}")
    if result["errors"]:
        print("\n错误:")
        for error in result["errors"]:
            print(f"- {error}")
    summary = result["summary"]
    print(
        "\nSUMMARY "
        f"mode={result['mode']} required={summary['required']} passed={summary['passed']} "
        f"failed={summary['failed']} skipped={summary['skipped']} errors={summary['errors']}"
    )
    if result["mode"] == "structural-only":
        print("注意: structural-only 不验证证据文件，不能作为集成验收结论。")


def main() -> int:
    args = parse_args()
    try:
        manifest = load_manifest(args.manifest.resolve())
        project_root = args.project_root.resolve()
        if not project_root.is_dir():
            raise ValueError(f"project-root 不是目录: {project_root}")
        result = validate_manifest(manifest, project_root, args.structural_only)
    except (OSError, ValueError) as exc:
        result = {
            "success": False,
            "mode": "structural-only" if args.structural_only else "evidence",
            "summary": {
                "required": 0,
                "passed": 0,
                "failed": 0,
                "skipped": 0,
                "errors": 1,
            },
            "requirements": [],
            "errors": [str(exc)],
        }
    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print_text(result)
    return 0 if result["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
