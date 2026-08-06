# Lanzador de localhost

Programa en Python para Windows que permite:

- seleccionar una carpeta,
- elegir un puerto,
- iniciar un servidor `localhost` con un boton,
- detenerlo desde la misma ventana.

## Ejecutar en Python

```bat
python server_launcher.py
```

## Generar `.exe`

Opcion 1:

```bat
build_exe.bat
```

Opcion 2:

```bat
python -m pip install pyinstaller
python -m PyInstaller --noconsole --onefile --name LanzadorLocalhost server_launcher.py
```

El ejecutable queda en:

```text
dist\LanzadorLocalhost.exe
```
