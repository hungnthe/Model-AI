import { readFileSync, writeFileSync } from 'node:fs';

const [sourcePath, outputPath = 'hosteye-rcf-input.json'] = process.argv.slice(2);
if (!sourcePath) throw new Error('Usage: node scripts/build-hosteye-input.mjs <source.json> [output.json]');

const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
if (source.schema_version !== 'hosteye.clickhouse.analysis.v1' || !Array.isArray(source.logs)) {
  throw new Error('Expected HostEye ClickHouse analysis export with a logs array.');
}
if (source.logs.length < 3 || source.logs.length > 2000) {
  throw new Error('The app accepts 3 to 2000 log rows.');
}

const data = source.logs.map((log, index) => {
  const eventAge = log.event_age_at_ingest_seconds;
  if (typeof eventAge !== 'number' || !Number.isFinite(eventAge)) {
    throw new Error(`Row ${index + 1} has no finite event age.`);
  }
  if (typeof log.hosteye_event_id !== 'string' || typeof log.timestamp !== 'string') {
    throw new Error(`Row ${index + 1} is missing an event ID or timestamp.`);
  }
  return {
    id: log.hosteye_event_id,
    timestamp: log.timestamp,
    computer: log.computer,
    channel: log.channel,
    event_id: String(log.event_id),
    level: log.level,
    event_age_seconds: eventAge,
    message_length: String(log.message ?? '').length,
    is_error: Number(log.level === 'Error'),
    is_sysmon: Number(log.channel === 'Microsoft-Windows-Sysmon/Operational'),
    is_firewall: Number(log.channel === 'Microsoft-Windows-Windows Firewall With Advanced Security/Firewall'),
    has_dns_query: Number(Boolean(log.dns_query)),
    has_process_path: Number(Boolean(log.process_path)),
    has_network_destination: Number(Boolean(log.destination_ip) || Number(log.destination_port) > 0),
  };
});

const output = {
  schema_version: 'hosteye.rcf.input.v1',
  source_snapshot_utc: source.source?.snapshot_as_of_utc ?? null,
  source_export_sha256: source.source?.source_export_sha256 ?? null,
  sample_note: 'These are stratified sample rows, not the full event population. Anomaly scores are statistical, not security verdicts.',
  feature_notes: {
    event_age_seconds: 'Age at ingest; includes buffering, backfill and clock skew, not network latency.',
    message_length: 'Length of the exported message, which may be truncated at 2000 characters.',
    is_error: '1 for Windows Error level; an error is not automatically a security incident.',
    is_sysmon: '1 for the Sysmon channel.',
    is_firewall: '1 for the Windows Firewall channel.',
    has_dns_query: '1 when a DNS query is present.',
    has_process_path: '1 when a process path is present.',
    has_network_destination: '1 when a destination IP or nonzero port is present.',
  },
  data,
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${data.length} rows to ${outputPath}`);
