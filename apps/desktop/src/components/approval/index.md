# components/approval/
- approval-dialog.tsx — bounded sealed request presentation with wrapped target fields, explicit choices, and a current background-use acknowledgement; disclosure revision remains internal
- approval-dialog-controller.ts — socket-local FIFO queue, disclosure proof, expiry/close retirement, response feedback, and generation guard
- use-approval-dialog.tsx — one React owner per physical WsClient, adapting controller snapshots into the modal
