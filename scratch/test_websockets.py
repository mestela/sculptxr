import sys
try:
    import websockets
    print("Websockets is installed!")
except ImportError:
    print("Websockets is NOT installed.")
