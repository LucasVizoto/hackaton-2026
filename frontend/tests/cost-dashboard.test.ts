import "@angular/compiler";
import assert from "node:assert/strict";
import test from "node:test";
import { costChart, DailyCost, managementPeriodError, waitDuration, waitLeaders } from "../src/app/core/cost-chart";

const row = (date:string, production:string|null, payable:string|null):DailyCost => ({date, production, total_payable:payable, supplement:production===null ? null : "0", bulletin_count:production===null ? 0 : 1});

test("line geometry splits missing days and preserves isolated and observed zero points", () => {
  const series=[row("2026-10-01","10","20"),row("2026-10-02","15","25"),row("2026-10-03",null,null),row("2026-10-04","0","0")];
  const chart=costChart(series);
  assert.equal(chart.measuredDays,3);
  assert.equal(chart.segments.length,2);
  assert.equal(chart.segments[0].points.length,2);
  assert.ok(chart.segments[0].area.endsWith("Z"));
  assert.equal(chart.segments[1].points.length,1);
  assert.equal(chart.segments[1].area,"");
  assert.equal(chart.segments[1].points[0].productionY,210);
  assert.deepEqual(series[2],row("2026-10-03",null,null));
});

test("empty, invalid and one-point series remain finite and do not fabricate values", () => {
  assert.equal(costChart([]).segments.length,0);
  assert.deepEqual(costChart([]).dates,[]);
  for(const value of ["", "bad", "Infinity", "-1"]) assert.equal(costChart([row("2026-10-01",value,"3")]).measuredDays,0);
  const point=costChart([row("2026-10-01","0","0")]).segments[0].points[0];
  assert.ok(Number.isFinite(point.x));
  assert.ok(Number.isFinite(point.productionY));
});

test("wait highlights show every tie, measured zero and exclude unavailable coverage", () => {
  const rows=[{warehouse:"a",warehouse_name:"A",average_minutes:135,valid_records:2,excluded_records:1},
    {warehouse:"b",warehouse_name:"B",average_minutes:135,valid_records:1,excluded_records:0},
    {warehouse:"c",warehouse_name:"C",average_minutes:null,valid_records:0,excluded_records:1}];
  assert.deepEqual(waitLeaders(rows).map(row=>row.warehouse),["a","b"]);
  assert.equal(waitDuration(135),"2h 15m");
  assert.equal(waitLeaders([{...rows[0],average_minutes:0}])[0].average_minutes,0);
  assert.deepEqual(waitLeaders(null),[]);
});

test("period validation rejects missing, impossible, reversed and oversized ranges", () => {
  assert.ok(managementPeriodError("","2026-10-04"));
  assert.ok(managementPeriodError("2026-02-30","2026-10-04"));
  assert.ok(managementPeriodError("2026-10-05","2026-10-04"));
  assert.ok(managementPeriodError("2010-01-01","2026-10-04"));
  assert.equal(managementPeriodError("2026-10-04","2026-10-04"),"");
});
