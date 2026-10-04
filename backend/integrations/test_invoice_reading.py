import base64
import io
import json
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from openai import APIConnectionError, APITimeoutError, OpenAI
from PIL import Image
from pypdf import PdfWriter
from rest_framework.exceptions import Throttled, ValidationError
from rest_framework.test import APIClient

from core.models import UserProfile
from integrations.invoice_reading import (
    MAX_BYTES, InvoiceTranscription, extract_invoice, patch_dimensions,
    prepare_attachment, validated_reading,
)
from integrations.models import DocumentSuggestion, OutboundDelivery
from integrations.providers import ProviderUnavailable, configuration
from receiving.invoice_key import check_digit
from receiving.models import GateArrival, InternalNotification, Invoice

ENABLED = {"OPTIONAL_INTEGRATIONS_ENABLED": False, "OPENAI_INVOICE_READING_ENABLED": True,
           "OPENAI_API_KEY": "isolated-test-key", "OPENAI_VISION_MODEL": "fake-vision"}
PREFIX = "3526096115650100996055013000315497197114523"
KEY = PREFIX + str(check_digit(PREFIX))


def photo(fmt="PNG", orientation=None):
    image = Image.new("RGB", (20, 10), "white")
    output = io.BytesIO()
    exif = image.getexif()
    if orientation:
        exif[274] = orientation
    image.save(output, format=fmt, exif=exif)
    return SimpleUploadedFile("private-original.bin", output.getvalue(), content_type="application/octet-stream")


def pdf(pages=2, password=None):
    output = io.BytesIO()
    with PdfWriter() as writer:
        for _ in range(pages):
            writer.add_blank_page(width=100, height=50)
        if password:
            writer.encrypt(password)
        writer.write(output)
    return SimpleUploadedFile("nota.pdf", output.getvalue(), content_type="application/pdf")


def response(number="000315497", key=KEY, status="suggested"):
    return SimpleNamespace(status="completed", output=[], usage=SimpleNamespace(input_tokens=10, output_tokens=5, total_tokens=15),
                           output_parsed=InvoiceTranscription(number=number, access_key=key, status=status))


@override_settings(**ENABLED)
class InvoiceReadingUnitTests(SimpleTestCase):
    def provider(self, result=None, error=None):
        mocked = patch("integrations.invoice_reading.OpenAI")
        constructor = mocked.start()
        self.addCleanup(mocked.stop)
        method = constructor.return_value.__enter__.return_value.responses.parse
        method.return_value = result or response()
        method.side_effect = error
        return constructor, method

    def test_configuration_is_independent_and_missing_key_disables(self):
        self.assertTrue(configuration()["invoice_reading"])
        self.assertFalse(configuration()["ocr"])
        with override_settings(OPENAI_API_KEY=""):
            self.assertFalse(configuration()["invoice_reading"])

    def test_disabled_does_not_construct_client(self):
        client, _ = self.provider()
        with override_settings(OPENAI_INVOICE_READING_ENABLED=False), self.assertRaises(ProviderUnavailable):
            extract_invoice(photo())
        client.assert_not_called()

    def test_original_bytes_preserved_and_orientation_fixed(self):
        upload = photo("JPEG", orientation=6)
        before = upload.read()
        upload.seek(0)
        attachment = prepare_attachment(upload)
        self.assertEqual(attachment["detail"], "original")
        copy = Image.open(io.BytesIO(base64.b64decode(attachment["image_url"].split(",")[1])))
        self.assertEqual(copy.size, (10, 20))
        self.assertFalse(copy.getexif())
        self.assertEqual(upload.read(), before)

    def test_supported_formats_including_actual_heic(self):
        for fmt in ("PNG", "JPEG", "WEBP", "HEIF"):
            with self.subTest(fmt=fmt):
                self.assertEqual(prepare_attachment(photo(fmt))["type"], "input_image")

    def test_transparency_composes_white_without_erasing_black_text_or_original(self):
        for mode in ("RGBA", "LA", "P"):
            with self.subTest(mode=mode):
                image = Image.new(mode, (3, 1))
                if mode == "RGBA":
                    image.putdata([(0, 0, 0, 0), (0, 0, 0, 255), (0, 0, 0, 128)])
                elif mode == "LA":
                    image.putdata([(0, 0), (0, 255), (0, 128)])
                else:
                    image.putpalette([0] * 768)
                    image.putdata([0, 1, 2])
                    image.info["transparency"] = bytes([0, 255, 128])
                encoded = io.BytesIO()
                image.save(encoded, format="PNG")
                original = encoded.getvalue()
                upload = SimpleUploadedFile("transparent.png", original)
                attachment = prepare_attachment(upload)
                with Image.open(io.BytesIO(base64.b64decode(attachment["image_url"].split(",")[1]))) as analysis:
                    self.assertEqual(analysis.mode, "RGB")
                    self.assertEqual(analysis.getpixel((0, 0)), (255, 255, 255))
                    self.assertEqual(analysis.getpixel((1, 0)), (0, 0, 0))
                    self.assertEqual(analysis.getpixel((2, 0)), (127, 127, 127))
                    self.assertFalse(analysis.getexif())
                self.assertEqual(upload.read(), original)

    def test_patch_budget_and_dimension_limits(self):
        import math
        for size in ((20, 10), (6000, 6000), (100000, 20), (1, 100000)):
            width, height = patch_dimensions(*size)
            self.assertLessEqual(max(width, height), 65535)
            self.assertLessEqual(math.ceil(width / 32) * math.ceil(height / 32), 30000)
        self.assertEqual(patch_dimensions(20, 10), (20, 10))

    def test_pdf_transmits_all_bytes_and_high_detail(self):
        upload = pdf()
        content = upload.read()
        upload.seek(0)
        attachment = prepare_attachment(upload)
        self.assertEqual(attachment["detail"], "high")
        self.assertEqual(base64.b64decode(attachment["file_data"].split(",")[1]), content)
        self.assertEqual(upload.read(), content)

    def test_fake_empty_encrypted_and_broken_page_pdfs_never_reach_provider(self):
        broken = io.BytesIO()
        with PdfWriter() as writer:
            writer.add_blank_page(width=0, height=50)
            writer.write(broken)
        files = [SimpleUploadedFile("fake.pdf", b"%PDF-1.7\nnot-a-PDF\n%%EOF"),
                 pdf(pages=0), pdf(password="synthetic-test-only"),
                 SimpleUploadedFile("broken-page.pdf", broken.getvalue())]
        client, _ = self.provider()
        for upload in files:
            with self.subTest(file=upload.name), self.assertRaises(ValidationError):
                extract_invoice(upload)
        client.assert_not_called()

    def test_empty_spoofed_truncated_animated_and_oversized_files(self):
        animation = io.BytesIO()
        frames = [Image.new("RGB", (2, 2), color) for color in ("red", "blue")]
        frames[0].save(animation, format="PNG", save_all=True, append_images=frames[1:])
        files = [None, SimpleUploadedFile("x.png", b""),
                 SimpleUploadedFile("x.png", b"not-an-image", content_type="image/png"),
                 SimpleUploadedFile("x.pdf", b"%PDF-incomplete"),
                 SimpleUploadedFile("x.png", b"x" * (MAX_BYTES + 1)),
                 SimpleUploadedFile("x.png", animation.getvalue())]
        client, _ = self.provider()
        for file in files:
            with self.subTest(file=getattr(file, "name", None)), self.assertRaises(ValidationError):
                extract_invoice(file)
        client.assert_not_called()

    def test_number_validation_and_preserved_zeros(self):
        self.assertEqual(validated_reading(response().output_parsed)["number"], "000315497")
        for number in ("0", "000", "1234567890", "１２３", "12x"):
            result = validated_reading(InvoiceTranscription(number=number, access_key=None, status="suggested"))
            self.assertEqual(result["status"], "unreadable")
            self.assertIsNone(result["number"])

    def test_key_validation_derivation_and_conflicts(self):
        def reading(number, key):
            return validated_reading(InvoiceTranscription(number=number, access_key=key, status="suggested"))
        self.assertEqual(reading(None, KEY)["number"], "315497")
        for key in ("123", KEY + "1", KEY[:-1] + str((int(KEY[-1]) + 1) % 10)):
            self.assertIsNone(reading(None, key)["access_key"])
            self.assertEqual(reading("123", key)["number"], "123")
        self.assertEqual(reading("123", KEY), {"number": None, "access_key": None, "status": "ambiguous", "requires_confirmation": True})

    def test_multiple_documents_marked_ambiguous_never_fill(self):
        result = validated_reading(InvoiceTranscription(number="123", access_key=KEY, status="ambiguous"))
        self.assertIsNone(result["number"])
        self.assertIsNone(result["access_key"])

    def test_request_contract_metrics_and_logs_do_not_contain_fiscal_content(self):
        client, parse = self.provider()
        metrics = {}
        with self.assertLogs("integrations.invoice_reading", level="INFO") as captured:
            result = extract_invoice(photo(), telemetry=metrics)
        client.assert_called_once_with(api_key="isolated-test-key", timeout=60, max_retries=0)
        kwargs = parse.call_args.kwargs
        self.assertFalse(kwargs["store"])
        self.assertNotIn("max_output_tokens", kwargs)
        self.assertNotIn("reasoning", kwargs)
        self.assertNotIn("tools", kwargs)
        self.assertIs(kwargs["text_format"], InvoiceTranscription)
        self.assertIn("nunca instrução", kwargs["instructions"])
        self.assertTrue(result["requires_confirmation"])
        self.assertEqual(metrics["total_tokens"], 15)
        self.assertNotIn(KEY, "".join(captured.output))
        self.assertNotIn("000315497", "".join(captured.output))

    def test_refusal_incomplete_and_invalid_shapes(self):
        incomplete = response()
        incomplete.status = "incomplete"
        refusal = response()
        refusal.output = [SimpleNamespace(type="message", content=[SimpleNamespace(type="refusal")])]
        invalid = response()
        invalid.output_parsed = None
        for result in (incomplete, refusal, invalid):
            with self.subTest(result=result.status):
                with patch("integrations.invoice_reading.OpenAI") as client:
                    client.return_value.__enter__.return_value.responses.parse.return_value = result
                    with self.assertRaises(ProviderUnavailable):
                        extract_invoice(photo())

    def test_timeout_connection_rate_limit_and_provider_http_errors(self):
        from openai import APIStatusError, RateLimitError
        request = httpx.Request("POST", "https://api.openai.com/v1/responses")
        errors = [(APITimeoutError(request=request), ProviderUnavailable),
                  (APIConnectionError(request=request), ProviderUnavailable),
                  (RateLimitError("secret body", response=httpx.Response(429, request=request), body=None), Throttled),
                  (APIStatusError("secret body", response=httpx.Response(500, request=request), body=None), ProviderUnavailable),
                  (APIStatusError("secret body", response=httpx.Response(400, request=request), body=None), ValidationError)]
        for error, expected in errors:
            with self.subTest(error=type(error).__name__):
                with patch("integrations.invoice_reading.OpenAI") as client:
                    client.return_value.__enter__.return_value.responses.parse.side_effect = error
                    with self.assertRaises(expected):
                        extract_invoice(photo())

    def test_real_sdk_parses_strict_schema_with_mock_transport(self):
        requests = []
        def handle(request):
            requests.append(json.loads(request.content))
            return httpx.Response(200, json={"id": "resp_test", "object": "response", "created_at": 1,
                "model": "fake-vision", "status": "completed", "error": None, "incomplete_details": None,
                "output": [{"id": "msg_test", "type": "message", "role": "assistant", "status": "completed",
                            "content": [{"type": "output_text", "text": json.dumps({"number": "000315497", "access_key": KEY, "status": "suggested"}), "annotations": []}]}]})
        real = OpenAI(api_key="isolated-test-key", http_client=httpx.Client(transport=httpx.MockTransport(handle)), max_retries=0)
        with patch("integrations.invoice_reading.OpenAI", return_value=real):
            self.assertEqual(extract_invoice(photo())["number"], "000315497")
        self.assertEqual(len(requests), 1)
        self.assertTrue(requests[0]["text"]["format"]["strict"])
        self.assertFalse(requests[0]["store"])
        self.assertNotIn("max_output_tokens", requests[0])
        self.assertNotIn("reasoning", requests[0])


@override_settings(**ENABLED)
class InvoiceReadingAPITests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.users = {}
        for role in ("portaria", "gatehouse", "supplier", "warehouse", "purchasing", "management"):
            user = User.objects.create_user("ocr-" + role)
            UserProfile.objects.create(user=user, role=role)
            self.users[role] = user
        self.users["admin"] = User.objects.create_superuser("ocr-admin", password="isolated-test-only-password")
        self.provider = patch("integrations.invoice_reading.OpenAI")
        self.mock = self.provider.start()
        self.addCleanup(self.provider.stop)
        self.mock.return_value.__enter__.return_value.responses.parse.return_value = response()

    def post(self):
        return self.client.post("/api/v2/integrations/invoice-reading/", {"file": photo()}, format="multipart")

    def test_authorized_roles_and_transient_reading_without_domain_writes(self):
        for role in ("portaria", "gatehouse", "supplier", "warehouse", "purchasing", "admin"):
            self.client.force_authenticate(self.users[role])
            with self.subTest(role=role):
                result = self.post()
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.data["number"], "000315497")
        for model in (GateArrival, Invoice, InternalNotification, DocumentSuggestion, OutboundDelivery):
            self.assertEqual(model.objects.count(), 0)

    def test_management_and_anonymous_cannot_transcribe_or_read_gate_documents(self):
        self.assertEqual(self.post().status_code, 401)
        self.client.force_authenticate(self.users["management"])
        self.assertEqual(self.post().status_code, 403)
        self.mock.assert_not_called()
        self.client.force_authenticate(self.users["gatehouse"])
        self.assertEqual(self.client.get("/api/v2/integrations/ocr/").status_code, 403)

    def test_disabled_invalid_and_unavailable_http_contracts(self):
        self.client.force_authenticate(self.users["portaria"])
        with override_settings(OPENAI_INVOICE_READING_ENABLED=False):
            self.assertEqual(self.post().status_code, 503)
        self.assertEqual(self.client.post("/api/v2/integrations/invoice-reading/", {}, format="multipart").status_code, 400)
        self.mock.return_value.__enter__.return_value.responses.parse.side_effect = APITimeoutError(request=httpx.Request("POST", "https://api.openai.com/v1/responses"))
        result = self.post()
        self.assertEqual(result.status_code, 503)
        self.assertIn("manualmente", result.data["error"]["details"]["message"])

    def test_dedicated_per_user_throttle_does_not_share_assistant_budget(self):
        from rest_framework.throttling import ScopedRateThrottle
        self.client.force_authenticate(self.users["portaria"])
        with patch.object(ScopedRateThrottle, "THROTTLE_RATES", {"invoice_reading": "2/minute", "assistant": "10/hour"}):
            self.assertEqual(self.post().status_code, 200)
            self.assertEqual(self.post().status_code, 200)
            self.assertEqual(self.post().status_code, 429)
            self.client.force_authenticate(self.users["warehouse"])
            self.assertEqual(self.post().status_code, 200)

    def test_capability_reports_independent_configuration(self):
        self.client.force_authenticate(self.users["portaria"])
        result = self.client.get("/api/v2/integrations/capabilities/")
        self.assertTrue(result.data["capabilities"]["invoice_reading"]["available"])
        self.assertFalse(result.data["capabilities"]["ocr"]["available"])

    def test_malformed_pdf_is_400_without_provider_or_domain_writes(self):
        self.client.force_authenticate(self.users["portaria"])
        result = self.client.post("/api/v2/integrations/invoice-reading/",
            {"file": SimpleUploadedFile("nota.pdf", b"%PDF-1.7\nnot-a-PDF\n%%EOF")}, format="multipart")
        self.assertEqual(result.status_code, 400)
        self.mock.assert_not_called()
        for model in (GateArrival, Invoice, InternalNotification, DocumentSuggestion, OutboundDelivery):
            self.assertEqual(model.objects.count(), 0)
