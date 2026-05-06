"""Tests para inbox_processor_service.

Cubre las funciones puras (parsing, sanitizing, prompt building) sin
necesidad de IMAP/Dropbox/Anthropic reales. Las funciones IO-bound
(`poll_inbox`, `classify_pending`) requieren mocks pesados — testean
mejor en integración.
"""
from __future__ import annotations

from datetime import datetime
from email import message_from_string

import pytest

from app.services.inbox_processor_service import (
    build_classifier_prompt,
    extract_attachments_meta,
    extract_body,
    inbox_dropbox_path,
    parse_address,
    parse_addresses,
    safe_filename,
)


class TestParseAddress:
    def test_simple_email(self) -> None:
        addr, name = parse_address("foo@example.com")
        assert addr == "foo@example.com"
        assert name is None

    def test_with_display_name(self) -> None:
        addr, name = parse_address("Foo Bar <foo@example.com>")
        assert addr == "foo@example.com"
        assert name == "Foo Bar"

    def test_normalizes_lowercase(self) -> None:
        addr, _ = parse_address("FOO@EXAMPLE.COM")
        assert addr == "foo@example.com"

    def test_strips_whitespace(self) -> None:
        addr, _ = parse_address("  foo@example.com  ")
        assert addr == "foo@example.com"

    def test_none_returns_empty(self) -> None:
        addr, name = parse_address(None)
        assert addr == ""
        assert name is None


class TestParseAddresses:
    def test_multiple_comma_separated(self) -> None:
        result = parse_addresses("foo@example.com, bar@example.com")
        assert result == ["foo@example.com", "bar@example.com"]

    def test_with_display_names(self) -> None:
        result = parse_addresses("Foo <foo@x.com>, Bar <bar@x.com>")
        assert "foo@x.com" in result
        assert "bar@x.com" in result

    def test_semicolon_separator(self) -> None:
        result = parse_addresses("a@x.com; b@x.com")
        assert result == ["a@x.com", "b@x.com"]

    def test_none_returns_empty_list(self) -> None:
        assert parse_addresses(None) == []

    def test_empty_string_returns_empty(self) -> None:
        assert parse_addresses("") == []


class TestSafeFilename:
    def test_basic(self) -> None:
        assert safe_filename("invoice.pdf") == "invoice.pdf"

    def test_replaces_forbidden_chars(self) -> None:
        result = safe_filename("a/b\\c<d>e:f|g.pdf")
        assert "/" not in result
        assert "\\" not in result
        assert "<" not in result
        assert ":" not in result

    def test_strips_leading_trailing_dots(self) -> None:
        assert safe_filename("...file.pdf...") == "file.pdf"

    def test_empty_string_returns_unnamed(self) -> None:
        assert safe_filename("") == "unnamed"

    def test_only_dots_returns_unnamed(self) -> None:
        assert safe_filename("...") == "unnamed"

    def test_truncates_to_200_chars(self) -> None:
        long_name = "a" * 300 + ".pdf"
        assert len(safe_filename(long_name)) <= 200

    def test_unicode_nfc_normalize(self) -> None:
        # "é" en NFD: "e" + combining acute (2 codepoints)
        nfd = "facturé.pdf"  # facturé.pdf
        result = safe_filename(nfd)
        # NFC componer a 1 codepoint: "facturé.pdf" tiene 11 chars
        assert "́" not in result  # combining mark se compuso
        assert "é" in result or "é" in result

    def test_strips_control_chars(self) -> None:
        # Newline en filename = red flag
        result = safe_filename("file\nwith\rnewline.pdf")
        assert "\n" not in result
        assert "\r" not in result


class TestInboxDropboxPath:
    def test_uses_year_month(self) -> None:
        dt = datetime(2026, 5, 4)
        path = inbox_dropbox_path(dt, "invoice.pdf")
        assert "/2026/" in path
        assert "/05/" in path
        assert path.endswith("invoice.pdf")

    def test_sanitizes_filename(self) -> None:
        dt = datetime(2026, 5, 4)
        path = inbox_dropbox_path(dt, "bad/name.pdf")
        assert "/" not in path.split("/")[-1]  # no slashes en filename final

    def test_uses_correct_root(self) -> None:
        dt = datetime(2026, 5, 4)
        path = inbox_dropbox_path(dt, "x.pdf")
        assert path.startswith("/Cehta Capital/00-Inbox/")


class TestExtractBody:
    def test_plain_text_only(self) -> None:
        msg = message_from_string(
            "From: foo@x.com\r\n"
            "Subject: Test\r\n"
            "Content-Type: text/plain; charset=utf-8\r\n"
            "\r\n"
            "Hola mundo"
        )
        text, html = extract_body(msg)
        assert text == "Hola mundo"
        assert html is None

    def test_html_only(self) -> None:
        msg = message_from_string(
            "From: foo@x.com\r\n"
            "Content-Type: text/html; charset=utf-8\r\n"
            "\r\n"
            "<p>Hola</p>"
        )
        text, html = extract_body(msg)
        assert html == "<p>Hola</p>"

    def test_skips_attachments(self) -> None:
        # multipart con texto + un "adjunto"
        raw = (
            "From: foo@x.com\r\n"
            'Content-Type: multipart/mixed; boundary="BOUNDARY"\r\n'
            "\r\n"
            "--BOUNDARY\r\n"
            "Content-Type: text/plain\r\n"
            "\r\n"
            "Cuerpo\r\n"
            "--BOUNDARY\r\n"
            'Content-Type: application/pdf; name="x.pdf"\r\n'
            'Content-Disposition: attachment; filename="x.pdf"\r\n'
            "\r\n"
            "PDFCONTENT\r\n"
            "--BOUNDARY--\r\n"
        )
        msg = message_from_string(raw)
        text, _ = extract_body(msg)
        assert "Cuerpo" in (text or "")
        assert "PDFCONTENT" not in (text or "")


class TestExtractAttachmentsMeta:
    def test_no_attachments_for_plain_email(self) -> None:
        msg = message_from_string(
            "From: foo@x.com\r\n"
            "Content-Type: text/plain\r\n\r\nHola"
        )
        assert extract_attachments_meta(msg) == []

    def test_extracts_attachment(self) -> None:
        raw = (
            "From: foo@x.com\r\n"
            'Content-Type: multipart/mixed; boundary="B"\r\n'
            "\r\n"
            "--B\r\n"
            "Content-Type: text/plain\r\n\r\nbody\r\n"
            "--B\r\n"
            'Content-Type: application/pdf; name="invoice.pdf"\r\n'
            'Content-Disposition: attachment; filename="invoice.pdf"\r\n'
            "\r\nPDFDATA\r\n"
            "--B--\r\n"
        )
        msg = message_from_string(raw)
        attachments = extract_attachments_meta(msg)
        assert len(attachments) == 1
        assert attachments[0]["filename"] == "invoice.pdf"
        assert attachments[0]["content_type"] == "application/pdf"
        # _payload no debe estar (es solo en extract_attachments)
        assert "_payload" not in attachments[0]


class TestBuildClassifierPrompt:
    def test_includes_subject_and_from(self) -> None:
        prompt = build_classifier_prompt(
            "Factura 1234", "proveedor@x.cl", "Adjunto factura..."
        )
        assert "Factura 1234" in prompt
        assert "proveedor@x.cl" in prompt
        assert "Adjunto factura" in prompt

    def test_caps_body_to_3000_chars(self) -> None:
        long_body = "a" * 5000
        prompt = build_classifier_prompt("S", "f@x.com", long_body)
        # El cuerpo en el prompt no debe contener los 5000 chars
        assert "a" * 5000 not in prompt
        # Pero sí los primeros 3000
        assert "a" * 3000 in prompt

    def test_handles_empty_body(self) -> None:
        prompt = build_classifier_prompt("S", "f@x.com", "")
        # No debe crashear
        assert "S" in prompt

    def test_categorias_listadas(self) -> None:
        prompt = build_classifier_prompt("S", "f@x.com", "")
        # Asegurar que las categorías esperadas estén documentadas
        for cat in [
            "factura_proveedor",
            "boleta_honorarios",
            "pago_confirmado",
            "consulta_lp",
            "spam",
            "notif_banco",
            "notif_sii",
        ]:
            assert cat in prompt
