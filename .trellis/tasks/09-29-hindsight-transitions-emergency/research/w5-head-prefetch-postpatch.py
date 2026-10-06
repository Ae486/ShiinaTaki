"""Parent-only successor of the checked native-view entry; default does no work."""

from pathlib import Path

import w5_actual_embedding_control as control
import w5_head_prefetch_inventory as inventory

# Load the sealed wrapper into its own module. Only its two documented
# composition inputs change; the original entry module and file remain intact.
# Its V2 adaptation uses ENTRY for the actual worker, so both processes verify
# the same successor inventory and retain all four reports and failure records.
entry = control.load(
    "w5_head_prefetch_composed_native_view", "w5-native-view-postpatch.py"
)
entry.inventory = inventory
entry.ENTRY = Path(__file__).resolve()


if __name__ == "__main__":
    entry.main()
