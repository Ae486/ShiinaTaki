"""Timer-only asyncio loop for offline tests without Windows loopback sockets."""

import asyncio
import selectors
import threading


class TimerSelector(selectors.BaseSelector):
    def __init__(self):
        self.wakeup = threading.Event()

    def register(self, *args, **kwargs):
        raise AssertionError("Offline test attempted native I/O")

    def unregister(self, *args, **kwargs):
        raise AssertionError("No native I/O registered")

    def select(self, timeout=None):
        self.wakeup.wait(timeout)
        self.wakeup.clear()
        return []

    def get_map(self):
        return {}


class TimerLoop(asyncio.SelectorEventLoop):
    def __init__(self):
        super().__init__(TimerSelector())

    def _make_self_pipe(self):
        pass

    def _close_self_pipe(self):
        pass

    def _write_to_self(self):
        self._selector.wakeup.set()


def run_async(coroutine):
    with asyncio.Runner(loop_factory=TimerLoop) as runner:
        return runner.run(coroutine)
