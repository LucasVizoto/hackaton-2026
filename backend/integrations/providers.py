"""Optional outbound adapters. No provider credentials or success simulations in the client."""
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email


class ProviderUnavailable(Exception):
    def __init__(self, code="unavailable", *, uncertain=False):
        self.code, self.uncertain = code, uncertain
        super().__init__(code)


def configuration():
    enabled = settings.OPTIONAL_INTEGRATIONS_ENABLED
    try:
        location_valid = -90 <= float(settings.WEATHER_LATITUDE) <= 90 and -180 <= float(settings.WEATHER_LONGITUDE) <= 180
    except (TypeError, ValueError):
        location_valid = False
    return {
        "assistant": enabled and bool(settings.OPENAI_API_KEY and settings.OPENAI_MODEL),
        "ocr": enabled and bool(settings.OPENAI_API_KEY and settings.OPENAI_VISION_MODEL),
        "invoice_reading": settings.OPENAI_INVOICE_READING_ENABLED and bool(settings.OPENAI_API_KEY and settings.OPENAI_VISION_MODEL),
        "email": enabled and bool(settings.EMAIL_HOST and settings.DEFAULT_FROM_EMAIL and (settings.DIGEST_EMAIL_RECIPIENTS or notification_email_recipients())),
        "google_calendar": enabled and bool(settings.GOOGLE_CALENDAR_ID and settings.GOOGLE_CALENDAR_ACCESS_TOKEN),
        "whatsapp": enabled and bool(settings.WHATSAPP_TOKEN and settings.WHATSAPP_PHONE_ID and settings.WHATSAPP_API_VERSION and settings.WHATSAPP_RECIPIENTS and settings.WHATSAPP_TEMPLATE),
        "weather": enabled and location_valid,
    }


def notification_email_recipients(role=None):
    """Only explicit operational role allowlists; never infer recipients from accounts."""
    configured = getattr(settings, "NOTIFICATION_EMAIL_RECIPIENTS", {})
    if not isinstance(configured, dict):
        return []
    roles = [role] if role else ["warehouse", "purchasing", "gatehouse"]
    result = []
    for target in roles:
        if target not in {"warehouse", "purchasing", "gatehouse"}:
            continue
        values = configured.get(target, [])
        if not isinstance(values, (list, tuple)):
            continue
        for address in values:
            if not isinstance(address, str):
                continue
            try:
                validate_email(address)
            except ValidationError:
                continue
            if address not in result:
                result.append(address)
    return result


def require_configuration(channel):
    if not configuration().get(channel):
        raise ProviderUnavailable("not_configured")


def json_request(url, *, method="GET", body=None, token=None, timeout=30):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            content = response.read(4 * 1024 * 1024 + 1)
        if len(content) > 4 * 1024 * 1024:
            raise ProviderUnavailable("response_too_large", uncertain=method != "GET")
        data = json.loads(content) if content else {}
        if not isinstance(data, dict):
            raise ProviderUnavailable("invalid_response_shape", uncertain=method != "GET")
        return data
    except HTTPError as error:
        raise ProviderUnavailable(f"http_{error.code}", uncertain=method != "GET" and (error.code >= 500 or error.code == 408)) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise ProviderUnavailable("provider_connection_or_response", uncertain=method != "GET") from None


def openai_response(content, *, instructions, vision=False):
    require_configuration("ocr" if vision else "assistant")
    data = json_request("https://api.openai.com/v1/responses", method="POST", token=settings.OPENAI_API_KEY, body={
        "model": settings.OPENAI_VISION_MODEL if vision else settings.OPENAI_MODEL,
        "store": False, "instructions": instructions, "input": [{"role": "user", "content": content}],
        "max_output_tokens": 2400,
    }, timeout=60)
    if data.get("status") != "completed":
        raise ProviderUnavailable("incomplete_response")
    try:
        text = "\n".join(part["text"] for item in data.get("output", []) if item.get("type") == "message"
                         for part in item.get("content", []) if part.get("type") == "output_text")
    except (TypeError, AttributeError, KeyError):
        raise ProviderUnavailable("invalid_response_shape") from None
    if not text.strip():
        raise ProviderUnavailable("empty_response")
    return {"text": text, "reference": data.get("id", "")}
