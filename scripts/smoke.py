"""Smoke test against a fresh, disposable SuperFix Compose project in mock mode."""

import base64
from datetime import date
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPCookieProcessor
from uuid import uuid4


BASE = os.environ.get("SUPERFIX_URL", "http://127.0.0.1:8088")
ADMIN = os.environ["BOOTSTRAP_ADMIN_EMAIL"]
BOOTSTRAP = os.environ["BOOTSTRAP_ADMIN_PASSWORD"]
TEMPORARY = "t" + secrets.token_urlsafe(5)
PASSWORD = "p" + secrets.token_urlsafe(5)
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQKHUCAAFgAMiROE43AAAAAElFTkSuQmCC"
)


class Client:
    def __init__(self):
        self.cookies = http.cookiejar.CookieJar()
        self.http = build_opener(HTTPCookieProcessor(self.cookies))

    def call(self, path, method="GET", value=None, expected=200, content_type="application/json"):
        headers = {}
        if method != "GET":
            token = self.call("/auth/csrf")
            headers[token["header"]] = token["token"]
        if value is not None:
            headers["Content-Type"] = content_type
            if not isinstance(value, bytes):
                value = json.dumps(value).encode()
        request = Request(BASE + "/api/v1" + path, data=value, headers=headers, method=method)
        try:
            response = self.http.open(request, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            payload = response.read()
            assert response.status == expected, (method, path, response.status, expected, payload[:300])
            if response.headers.get_content_type() in ("application/json", "application/problem+json") and payload:
                return json.loads(payload)
            return payload

    def login(self, email, password, expected=204):
        return self.call("/auth/login", "POST", urlencode({"email": email, "password": password}).encode(),
                         expected=expected, content_type="application/x-www-form-urlencoded")

    def provisioned_login(self, email, temporary):
        self.login(email, temporary)
        assert self.call("/auth/me")["user"]["mustChangePassword"]
        self.call("/auth/password", "POST", {"currentPassword": temporary, "password": PASSWORD}, expected=204)
        self.call("/auth/me", expected=401)
        self.login(email, PASSWORD)
        assert not self.call("/auth/me")["user"]["mustChangePassword"]


def diagnostic(client, path, repair, answers=None, key=None):
    data = {"key": key or str(uuid4()), "version": repair["version"], "answers": answers}
    return client.call(path + "/diagnostic", "POST", data)


def wait_for(client, path, status):
    for _ in range(40):
        current = client.call(path)
        if current["status"] != "PROCESSING":
            assert current["status"] == status, (status, current["status"], current["details"]["issue"])
            return current
        time.sleep(0.25)
    raise AssertionError(f"Timed out waiting for {status}")


def intake(client, category="refrigerator", fuel=None):
    return client.call("/cases", "POST", {
        "category": category, "symptoms": "Synthetic case. Temperature differs from the selected setting.",
        "fuel": fuel, "hazard": False,
    }, expected=201)


def user(client, team, email, role="TECHNICIAN", expected=200):
    return client.call(f"/admin/companies/{team}/users", "POST", {
        "email": email, "name": email.split("@")[0], "password": TEMPORARY, "role": role,
    }, expected=expected)


def transition(client, path, repair, action, decision=None):
    return client.call(path + "/transition/" + action, "POST", {"version": repair["version"], "decision": decision})


def test_workflow():
    admin = Client()
    admin.call("/auth/me", expected=401)
    admin.provisioned_login(ADMIN, BOOTSTRAP)
    suffix = uuid4().hex[:8]
    solo = admin.call("/admin/plans", "POST", {"name": "Solo " + suffix, "maxUsers": 1, "monthlyAiLimit": 1})
    team = admin.call("/admin/plans", "POST", {"name": "Team " + suffix, "maxUsers": 3, "monthlyAiLimit": 10})
    a = admin.call("/admin/companies", "POST", {"name": "Company A", "planId": team["id"], "active": True})["id"]
    b = admin.call("/admin/companies", "POST", {"name": "Company B", "planId": solo["id"], "active": True})["id"]
    email_a = f"tech-a-{suffix}@example.test"
    email_b = f"tech-b-{suffix}@example.test"
    email_lead = f"lead-{suffix}@example.test"
    a_user = user(admin, a, email_a)
    user(admin, a, email_lead, "COMPANY_ADMIN")
    other_user = user(admin, b, email_b)
    reset = f"/admin/companies/{b}/users/{other_user['id']}/password"
    admin.call(reset, "PUT", {"password": TEMPORARY[:-1]}, expected=400)
    admin.call(reset, "PUT", {"password": TEMPORARY}, expected=204)
    user(admin, b, f"extra-{suffix}@example.test", expected=409)
    admin.call(f"/admin/companies/{a}", "PUT", {"name": "Company A", "planId": solo["id"], "active": True}, expected=409)

    tech, other, lead = Client(), Client(), Client()
    tech.login(email_a, TEMPORARY)
    tech.call("/cases", expected=403)
    tech.provisioned_login(email_a, TEMPORARY)
    other.provisioned_login(email_b, TEMPORARY)
    lead.provisioned_login(email_lead, TEMPORARY)
    assert tech.call("/settings")["demo"]
    assert len(tech.call("/categories")) == 5
    assert len(lead.call(f"/admin/companies/{a}/users")["content"]) == 2
    lead.call(f"/admin/companies/{b}/users", expected=403)
    tech.call("/admin/companies", expected=403)

    repair = intake(tech)
    path = "/cases/" + repair["id"]
    other.call(path, expected=404)
    assert not other.call("/cases")["content"]
    assert lead.call(path)["id"] == repair["id"]
    assert tech.call("/cases?category=refrigerator&status=DRAFT")["totalElements"] == 1

    boundary = "superfix-smoke-boundary"
    form = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\n'
            'Content-Type: image/png\r\n\r\n').encode() + PNG + f"\r\n--{boundary}--\r\n".encode()
    repair = tech.call(path + "/photos", "POST", form, content_type=f"multipart/form-data; boundary={boundary}")
    photo_path = path + "/photos/" + repair["details"]["photos"][0]["id"]
    assert tech.call(photo_path).startswith(b"\xff\xd8")
    other.call(photo_path, expected=404)
    repair = transition(tech, path, repair, "pause")
    assert repair["status"] == "PAUSED"
    repair = transition(tech, path, repair, "resume")

    key = str(uuid4())
    diagnostic(tech, path, repair, key=key)
    diagnostic(tech, path, repair, key=key)
    repair = wait_for(tech, path, "AWAITING_ANSWERS")
    round_one = {"pattern": {"status": "ANSWERED", "value": "Continuously"}, "display": {"status": "UNAVAILABLE"}}
    repair = tech.call(path + "/answers", "PUT", {"version": repair["version"], "answers": round_one})
    assert tech.call(path)["details"]["rounds"][0]["answers"]["pattern"]["value"] == "Continuously"
    diagnostic(tech, path, repair, round_one)
    repair = wait_for(tech, path, "AWAITING_ANSWERS")
    diagnostic(tech, path, repair, {"temperature": {"status": "UNKNOWN"}, "settings": {"status": "ANSWERED", "value": "no"}})
    repair = wait_for(tech, path, "DIAGNOSIS_PROPOSED")
    assert len(repair["details"]["rounds"]) == 2
    assert repair["details"]["finding"]["steps"]
    repair = transition(tech, path, repair, "checklist", "ACCEPTED")

    today = date.today().isoformat()
    repair = tech.call(path + "/returns", "POST", {
        "version": repair["version"], "scheduledFor": today, "clientDate": today,
        "reason": "Return with a replacement part", "nextAction": "Verify operation",
        "parts": [{"name": "Test part", "partNumber": "T-1", "quantity": 1}],
    })
    assert repair["status"] == "PAUSED"
    visit = repair["returnVisit"]
    repair = tech.call(path + "/returns/" + visit["id"] + "/parts/" + visit["parts"][0]["id"],
                       "PATCH", {"version": repair["version"], "status": "RECEIVED"})
    repair = transition(tech, path, repair, "resume")
    assert repair["returnVisit"]["status"] == "STARTED"

    feedback = {"outcome": "UNRESOLVED", "rating": "GOOD", "feedback": "Useful fixture flow."}
    tech.call(path + f'/close?version={repair["version"]}', "POST", feedback, expected=409)
    checks = {item["id"]: {"status": "CONFIRMED"} for item in repair["checklist"]}
    checks["tools"] = {"status": "UNRESOLVED", "reason": "Synthetic tool still unaccounted for."}
    repair = tech.call(path + "/checklist", "PUT", {"version": repair["version"], "checks": checks})
    tech.call(path + f'/close?version={repair["version"]}', "POST", feedback, expected=409)
    checks["tools"] = {"status": "CONFIRMED"}
    repair = tech.call(path + "/checklist", "PUT", {"version": repair["version"], "checks": checks})
    missing_log = tech.call(path + f'/close?version={repair["version"]}', "POST", feedback, expected=409)
    assert missing_log["detail"] == "repairLogIncomplete"
    work_log = {
        "confirmedFault": "The appliance was operating at the wrong setting.",
        "confirmedCauseCode": None,
        "workStatus": "PERFORMED",
        "workPerformed": "Set the appliance to the documented operating setting.",
        "parts": [{"name": "Synthetic replacement part", "partNumber": "FIX-01", "quantity": 1}],
        "readings": [{"name": "Recorded temperature", "unit": "°C", "beforeValue": "8.4", "afterValue": "5.2"}],
        "verification": None,
    }
    save_log = {"version": repair["version"], "log": work_log}
    other.call(path + "/work-log", "PUT", save_log, expected=404)
    repair = tech.call(path + "/work-log", "PUT", save_log)
    assert tech.call(path)["details"]["workLog"]["log"] == work_log
    tech.call(path + "/work-log", "PUT", save_log, expected=409)
    missing_test = tech.call(path + f'/close?version={repair["version"]}', "POST", feedback, expected=409)
    assert missing_test["detail"] == "repairLogIncomplete"
    work_log["verification"] = {"result": "FAILED", "notes": "The symptom returned during the follow-up test."}
    repair = tech.call(path + "/work-log", "PUT", {"version": repair["version"], "log": work_log})
    mismatch = tech.call(path + f'/close?version={repair["version"]}', "POST",
                         {**feedback, "outcome": "RESOLVED"}, expected=409)
    assert mismatch["detail"] == "outcomeVerificationMismatch"
    previous_details = repair["details"]
    original_version = repair["version"]
    continue_path = path + "/transition/continue-diagnosis"
    other.call(continue_path, "POST", {"version": original_version}, expected=404)
    repair = transition(tech, path, repair, "continue-diagnosis")
    assert repair["status"] == "AWAITING_ANSWERS"
    tech.call(continue_path, "POST", {"version": original_version}, expected=409)
    repair = tech.call(path)
    assert repair["details"]["workLog"] is None and repair["details"]["checks"] == {}
    assert repair["details"]["finding"] is None
    assert repair["details"]["rounds"][:-1] == previous_details["rounds"]
    (attempt,) = repair["details"]["attempts"]
    assert attempt["workLog"]["log"] == work_log
    assert attempt["finding"] == previous_details["finding"] and attempt["checks"] == previous_details["checks"]
    follow_up = repair["details"]["rounds"][-1]
    assert follow_up["number"] == 3 and follow_up["followUpIntake"] and not follow_up["submitted"]

    diagnostic(tech, path, repair, {
        "followUpSameConditions": {"status": "ANSWERED", "value": "yes"},
        "followUpObservation": {"status": "ANSWERED", "value": "The display showed a new error during the follow-up."},
    })
    repair = wait_for(tech, path, "DIAGNOSIS_PROPOSED")
    assert repair["details"]["finding"]["cause"] != attempt["finding"]["cause"]
    assert any("new error" in item for item in repair["details"]["finding"]["evidence"])
    repair = transition(tech, path, repair, "checklist", "ACCEPTED")
    second_log = {
        **work_log,
        "workPerformed": "Recorded the corrected repair on the test fixture.",
        "verification": {"result": "PASSED", "notes": "The symptom did not return during the recorded test."},
    }
    repair = tech.call(path + "/work-log", "PUT", {"version": repair["version"], "log": second_log})
    rejected = tech.call(continue_path, "POST", {"version": repair["version"]}, expected=409)
    assert rejected["detail"] == "failedVerificationRequired"
    blocked = tech.call(path + f'/close?version={repair["version"]}', "POST",
                        {**feedback, "outcome": "RESOLVED"}, expected=409)
    assert blocked["detail"] == "checklistIncomplete"
    repair = tech.call(path + "/checklist", "PUT", {"version": repair["version"], "checks": checks})
    repair = tech.call(path + f'/close?version={repair["version"]}', "POST", {**feedback, "outcome": "RESOLVED"})
    assert repair["status"] == "CLOSED"
    assert repair["details"]["feedback"]["outcome"] == "RESOLVED"
    assert repair["details"]["workLog"]["log"] == second_log
    assert repair["details"]["attempts"] == [attempt]
    tech.call(path + "/work-log", "PUT", {"version": repair["version"], "log": work_log}, expected=409)
    other.call(path + "/archive", "POST", {"version": repair["version"]}, expected=404)
    repair = tech.call(path + "/archive", "POST", {"version": repair["version"]})
    assert repair["archivedAt"] is not None
    assert tech.call("/cases?archived=true")["totalElements"] == 1
    repair = tech.call(path + "/restore", "POST", {"version": repair["version"]})
    assert repair["archivedAt"] is None
    repair = tech.call(path + "/archive", "POST", {"version": repair["version"]})
    if os.environ.get("SUPERFIX_SMOKE_STATE"):
        repair = tech.call(path + "/restore", "POST", {"version": repair["version"]})
    else:
        tech.call(path + f'?version={repair["version"]}', "DELETE", expected=204)
        tech.call(path, expected=404)

    unsafe = intake(other, "cooktop", "GAS")
    result = diagnostic(other, "/cases/" + unsafe["id"], unsafe)
    assert result["status"] == "INCONCLUSIVE" and result["details"]["issue"] == "safetyEscalation"
    manual_path = "/cases/" + unsafe["id"]
    result = transition(other, manual_path, result, "checklist")
    result = other.call(manual_path + "/work-log", "PUT", {"version": result["version"], "log": {
        "workStatus": "NOT_PERFORMED", "parts": [], "readings": [],
        "verification": {"result": "NOT_PERFORMED", "notes": "Referred for further assessment."},
    }})
    result = other.call(manual_path + "/checklist", "PUT", {"version": result["version"], "checks": {
        item["id"]: {"status": "CONFIRMED"} for item in result["checklist"]
    }})
    result = other.call(manual_path + f'/close?version={result["version"]}', "POST",
                        {"outcome": "UNVERIFIED", "rating": "NOT_USED"})
    assert result["status"] == "CLOSED" and result["details"]["feedback"]["outcome"] == "UNVERIFIED"
    limited = intake(other, "washer")
    limited_path = "/cases/" + limited["id"]
    diagnostic(other, limited_path, limited)
    limited = wait_for(other, limited_path, "AWAITING_ANSWERS")
    limited = diagnostic(other, limited_path, limited, round_one)
    assert limited["status"] == "INCONCLUSIVE" and limited["details"]["issue"] == "aiLimit"
    assert limited["details"]["rounds"][0]["submitted"]

    admin.call(f"/admin/companies/{a}/users/{a_user['id']}/active", "PUT", {"active": False})
    tech.call("/auth/me", expected=401)
    tech.login(email_a, PASSWORD, expected=401)
    print("PASS: authentication, tenant isolation, photos, return visits, diagnostic rounds, repair log, failed-test follow-up, history, verification, checklist, feedback, archive, deletion, safety escalation, and quotas")
    state = os.environ.get("SUPERFIX_SMOKE_STATE")
    if state:
        Path(state).write_text(json.dumps({"email": email_lead, "password": PASSWORD, "case": path, "photo": photo_path}))


if __name__ == "__main__":
    test_workflow()
