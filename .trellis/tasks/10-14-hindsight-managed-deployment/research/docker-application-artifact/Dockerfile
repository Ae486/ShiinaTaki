FROM taki-hindsight-api:local
USER 0:0
COPY --chown=0:0 payload/ /opt/taki-c2b-application-input/
RUN ["/app/api/.venv/bin/python", "-I", "-B", "-S", "/opt/taki-c2b-application-input/install-artifact.py"]
ENV TIKTOKEN_CACHE_DIR=/opt/taki-c2b-application/tokenizer PYTHON_DOTENV_DISABLED=true
USER 1000:1000
ENTRYPOINT ["/app/api/.venv/bin/python", "-I", "-B", "-S", "/opt/taki-c2b-application/artifact-check.py"]
CMD []
