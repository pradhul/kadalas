import {
  collectCoverageExpiryAlerts,
  normalizeVehicleCoverageType,
  resolveSubjectCoverage,
  selectCurrentAndSupersededForSubject,
  vehicleSlotsForType,
  VEHICLE_COVERAGE_SCHEMA,
} from '../src/lib/coverageSlots';
import { ScanLikeDoc } from '../src/lib/coverageSlots';

const ON = new Date(Date.UTC(2026, 10, 15)); // 2026-11-15

function doc(
  id: string,
  coverageType: string,
  opts: {
    issuer: string;
    start: string;
    end: string;
    email?: string;
  },
): ScanLikeDoc {
  return {
    id,
    metadata: {
      coverageType,
      coverageSlots: vehicleSlotsForType(coverageType).join(','),
      issuer: opts.issuer,
      policyStartDate: opts.start,
      issueDate: opts.start,
      expiryDate: opts.end,
      registrationNumber: 'KA-01-AB-1234',
      subjectKey: 'vehicle:reg:KA01AB1234',
      subjectLabel: 'KA-01-AB-1234',
    },
    date: opts.email ?? opts.start,
  };
}

describe('normalizeVehicleCoverageType', () => {
  it.each([
    ['Package Policy', 'comprehensive'],
    ['Bundled motor cover', 'comprehensive'],
    ['Comprehensive', 'comprehensive'],
    ['Standalone OD', 'od_only'],
    ['Own Damage only', 'od_only'],
    ['OD only', 'od_only'],
    ['Liability Only', 'tp_only'],
    ['Act Only', 'tp_only'],
    ['Third Party', 'tp_only'],
    ['TP only', 'tp_only'],
  ])('maps %s → %s', (raw, expected) => {
    expect(normalizeVehicleCoverageType(raw)).toBe(expected);
  });
});

describe('vehicle coverage slots', () => {
  it('comprehensive replaced by split OD + long-term TP', () => {
    const documents = [
      doc('comp_2024', 'comprehensive', {
        issuer: 'GEICO',
        start: '2024-02-12',
        end: '2025-02-11',
      }),
      doc('tp_5yr', 'tp_only', {
        issuer: 'Go Digit',
        start: '2025-02-15',
        end: '2030-02-14',
      }),
      doc('od_2026', 'od_only', {
        issuer: 'Progressive',
        start: '2026-02-18',
        end: '2027-02-17',
      }),
    ];

    const view = resolveSubjectCoverage({
      subjectKey: 'vehicle:reg:KA01AB1234',
      subjectLabel: 'KA-01-AB-1234',
      schema: VEHICLE_COVERAGE_SCHEMA,
      documents,
      on: ON,
    });

    const od = view.slots.find((s) => s.slot.id === 'own_damage')!;
    const tp = view.slots.find((s) => s.slot.id === 'third_party')!;

    expect(od.current?.document.id).toBe('od_2026');
    expect(od.current?.insurer).toBe('Progressive');
    expect(tp.current?.document.id).toBe('tp_5yr');
    expect(tp.current?.insurer).toBe('Go Digit');
    expect(od.gap).toBe(false);
    expect(tp.gap).toBe(false);
    expect(view.summary).toMatch(/KA-01-AB-1234/);
    expect(view.summary).toMatch(/Progressive/);
    expect(view.summary).toMatch(/Go Digit/);

    const { currentIds, supersededIds } = selectCurrentAndSupersededForSubject({
      schema: VEHICLE_COVERAGE_SCHEMA,
      documents,
      on: ON,
    });
    expect(currentIds.has('od_2026')).toBe(true);
    expect(currentIds.has('tp_5yr')).toBe(true);
    expect(supersededIds.has('comp_2024')).toBe(true);
  });

  it('long-term TP stays current across annual OD renewals', () => {
    const documents = [
      doc('tp_5yr', 'tp_only', {
        issuer: 'Go Digit',
        start: '2025-02-15',
        end: '2030-02-14',
      }),
      doc('od_2025', 'od_only', {
        issuer: 'Progressive',
        start: '2025-02-16',
        end: '2026-02-15',
      }),
      doc('od_2026', 'od_only', {
        issuer: 'Progressive',
        start: '2026-02-18',
        end: '2027-02-17',
      }),
    ];

    const { currentBySlot, supersededIds } = selectCurrentAndSupersededForSubject({
      schema: VEHICLE_COVERAGE_SCHEMA,
      documents,
      on: ON,
    });

    expect(currentBySlot.own_damage).toBe('od_2026');
    expect(currentBySlot.third_party).toBe('tp_5yr');
    expect(supersededIds.has('od_2025')).toBe(true);
    expect(supersededIds.has('tp_5yr')).toBe(false);
  });

  it('newer OD-only does not displace an active long-term TP', () => {
    const documents = [
      doc('tp_5yr', 'tp_only', {
        issuer: 'Go Digit',
        start: '2025-02-15',
        end: '2030-02-14',
      }),
      doc('od_new', 'od_only', {
        issuer: 'HDFC Ergo',
        start: '2026-03-01',
        end: '2027-02-28',
      }),
    ];

    const view = resolveSubjectCoverage({
      subjectKey: 'vehicle:reg:KA01AB1234',
      subjectLabel: 'KA-01-AB-1234',
      schema: VEHICLE_COVERAGE_SCHEMA,
      documents,
      on: ON,
    });

    expect(view.slots.find((s) => s.slot.id === 'third_party')!.current!.document.id).toBe('tp_5yr');
    expect(view.slots.find((s) => s.slot.id === 'own_damage')!.current!.document.id).toBe('od_new');
  });

  it('newer comprehensive supersedes both OD and TP slots', () => {
    const documents = [
      doc('tp_5yr', 'tp_only', {
        issuer: 'Go Digit',
        start: '2025-02-15',
        end: '2030-02-14',
      }),
      doc('od_2026', 'od_only', {
        issuer: 'Progressive',
        start: '2026-02-18',
        end: '2027-02-17',
      }),
      doc('comp_new', 'comprehensive', {
        issuer: 'Allstate',
        start: '2026-06-01',
        end: '2027-05-31',
      }),
    ];

    const { currentIds, currentBySlot, supersededIds } = selectCurrentAndSupersededForSubject({
      schema: VEHICLE_COVERAGE_SCHEMA,
      documents,
      on: ON,
    });

    expect(currentBySlot.own_damage).toBe('comp_new');
    expect(currentBySlot.third_party).toBe('comp_new');
    expect(currentIds.size).toBe(1);
    expect(supersededIds.has('tp_5yr')).toBe(true);
    expect(supersededIds.has('od_2026')).toBe(true);
  });

  it('insurer switch on comprehensive keeps one current doc for both slots', () => {
    const documents = [
      doc('sf_2025', 'comprehensive', {
        issuer: 'State Farm',
        start: '2025-05-05',
        end: '2026-05-04',
      }),
      doc('as_2026', 'comprehensive', {
        issuer: 'Allstate',
        start: '2026-05-06',
        end: '2027-05-05',
      }),
    ];

    const view = resolveSubjectCoverage({
      subjectKey: 'vehicle:reg:MH12XY9876',
      subjectLabel: 'MH-12-XY-9876',
      schema: VEHICLE_COVERAGE_SCHEMA,
      documents,
      on: ON,
    });

    expect(view.slots.every((s) => s.current?.document.id === 'as_2026')).toBe(true);
    expect(view.slots.every((s) => s.current?.insurer === 'Allstate')).toBe(true);
    expect(view.summary).toMatch(/Allstate/);
  });

  it('flags OD gap and upcoming expiry per slot', () => {
    const documents = [
      doc('tp_only', 'tp_only', {
        issuer: 'Go Digit',
        start: '2025-02-15',
        end: '2030-02-14',
      }),
      // OD expired
      doc('od_old', 'od_only', {
        issuer: 'Progressive',
        start: '2025-02-16',
        end: '2026-02-15',
      }),
    ];

    const view = resolveSubjectCoverage({
      subjectKey: 'vehicle:reg:KA01AB1234',
      subjectLabel: 'KA-01-AB-1234',
      schema: VEHICLE_COVERAGE_SCHEMA,
      documents,
      on: ON,
      expiringWithinDays: 60,
    });

    const alerts = collectCoverageExpiryAlerts([view], 60);
    expect(alerts.some((a) => a.slotId === 'own_damage' && a.kind === 'gap')).toBe(true);
    expect(alerts.some((a) => a.slotId === 'third_party' && a.kind === 'gap')).toBe(false);
  });
});
