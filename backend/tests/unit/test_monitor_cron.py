"""Unit tests para monitor_cron (Round 126)."""
from __future__ import annotations

import scripts.monitor_cron as mc


def test_detect_anomalies_backend_down():
    health = {"status": "down", "response_ms": 30000, "error": "timeout"}
    metrics = {
        "drafts_over_7d": 0, "pendings_over_5d": 0,
        "sii_docs_unmatched_30d": 0,
        "last_backup_age_hours": 12,
    }
    anomalies = mc.detect_anomalies(health, metrics)
    cats = [a["category"] for a in anomalies]
    assert "backend_down" in cats
    severities = [a["severity"] for a in anomalies]
    assert "CRITICAL" in severities


def test_detect_anomalies_clean_state():
    health = {"status": "alive", "response_ms": 150}
    metrics = {
        "drafts_over_7d": 2, "pendings_over_5d": 1,
        "sii_docs_unmatched_30d": 0,
        "last_backup_age_hours": 12,
    }
    assert mc.detect_anomalies(health, metrics) == []


def test_detect_anomalies_backup_stale_critical():
    health = {"status": "alive", "response_ms": 100}
    metrics = {
        "drafts_over_7d": 0, "pendings_over_5d": 0,
        "sii_docs_unmatched_30d": 0,
        "last_backup_age_hours": 80,  # > 72h crítico
    }
    anomalies = mc.detect_anomalies(health, metrics)
    assert any(
        a["category"] == "backup_stale" and a["severity"] == "CRITICAL"
        for a in anomalies
    )


def test_detect_anomalies_drafts_stuck():
    health = {"status": "alive", "response_ms": 100}
    metrics = {
        "drafts_over_7d": 15,  # > 10 umbral
        "pendings_over_5d": 0,
        "sii_docs_unmatched_30d": 0,
        "last_backup_age_hours": 12,
    }
    anomalies = mc.detect_anomalies(health, metrics)
    assert any(a["category"] == "vouchers_stuck" for a in anomalies)


def test_detect_anomalies_slow_response():
    health = {"status": "alive", "response_ms": 3000}  # > 2000ms warning
    metrics = {
        "drafts_over_7d": 0, "pendings_over_5d": 0,
        "sii_docs_unmatched_30d": 0, "last_backup_age_hours": 12,
    }
    anomalies = mc.detect_anomalies(health, metrics)
    assert any(
        a["category"] == "backend_slow" and a["severity"] == "WARNING"
        for a in anomalies
    )


def test_detect_anomalies_multiple_categories():
    """Un sistema con múltiples problemas debe reportar todos."""
    health = {"status": "down", "response_ms": 30000}
    metrics = {
        "drafts_over_7d": 20, "pendings_over_5d": 10,
        "sii_docs_unmatched_30d": 100,
        "last_backup_age_hours": 100,
    }
    anomalies = mc.detect_anomalies(health, metrics)
    cats = {a["category"] for a in anomalies}
    assert "backend_down" in cats
    assert "vouchers_stuck" in cats
    assert "sii_gap" in cats
    assert "backup_stale" in cats


def test_periodo_mes_anterior():
    from scripts.auto_sync_cron import _periodo_mes_anterior
    # No podemos hardcodear el resultado pero podemos validar formato
    p = _periodo_mes_anterior()
    assert len(p) == 7  # YYYY-MM
    assert p[4] == "-"
    year, month = p.split("-")
    assert 2024 <= int(year) <= 2030
    assert 1 <= int(month) <= 12
