FROM taki-c2b-application:ad8bf8b8-9577-4420-9fd9-212574bd4568
USER 0:0
COPY --chown=0:0 payload/ /opt/taki-c2b-producer-input/
RUN ["/app/api/.venv/bin/python", "-I", "-B", "-S", "/opt/taki-c2b-producer-input/install-producer.py"]
USER 1000:1000
WORKDIR /home/hindsight/.pg0
ENTRYPOINT ["/app/api/.venv/bin/python", "-I", "-B", "-S", "/opt/taki-c2b-producer/fixture.py"]
CMD []
