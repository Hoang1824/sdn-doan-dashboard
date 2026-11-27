# Fixture limitations

These are minimal synthetic parser/reducer fixtures based on event names and
specific B8 values documented in `docs/API_CONTRACT_B8_DASHBOARD_DRAFT.md`.
They are not copies of the real S1/S8 JSONL files. The Ryu/timeline event
discriminator keys and supplemental values are illustrative until the
complete raw records are available. The `events.jsonl` fixtures use the
separate phase-state shape and intentionally have no event discriminator.

The S8 fixture includes the documented cookie/counter lifecycle and six
fixture rule identities. It cannot verify the full-run prediction total,
per-ID correspondence, or the real values of the other five cookies.
