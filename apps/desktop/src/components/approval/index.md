# components/approval/
- approval-dialog.tsx — bounded canonical request modal with explicit choices and a separate current background-use acknowledgement
- approval-dialog-controller.ts — socket-local FIFO queue, disclosure proof, expiry/close retirement, response feedback, and generation guard
- use-approval-dialog.tsx — one React owner per physical WsClient, adapting controller snapshots into the modal
