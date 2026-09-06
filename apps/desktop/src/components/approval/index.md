# components/approval/
- approval-dialog.tsx — sealed ordinary fields or one selectable complete literal command with keyboard scrolling, unchanged choices and background-use consent
- approval-dialog-controller.ts — socket-local FIFO queue, disclosure proof, expiry/close retirement, response feedback, and generation guard
- use-approval-dialog.tsx — one React owner per physical WsClient, adapting controller snapshots into the modal
