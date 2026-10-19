---
'@truefoundry/trueforge': patch
'@truefoundry/trueforge-core': patch
---

Store the session's last turn id and status together as `last_turn_details` on `SessionRecord`. Stores replace the whole document when a turn is created and when that turn pauses, resumes, finishes, or is cancelled; a status change from a turn that is no longer the last turn is ignored. Existing sessions are backfilled from their last turn.
