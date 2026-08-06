import os
import socket
import subprocess
import sys
import threading
import tkinter as tk
import webbrowser
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Callable, Literal
from tkinter import filedialog, messagebox


@dataclass
class PanelShell:
    outer: tk.Frame
    inner: tk.Frame


@dataclass
class ProjectButtonRef:
    button: tk.Button
    path: Path


class ServerLauncherApp:
    BG = "#1a1c24"
    PANEL = "#c7c3b8"
    PANEL_ALT = "#bdb8ab"
    FIELD = "#efede6"
    TEXT = "#1a1a1a"
    MUTED = "#4f5563"
    ACCENT = "#1f5aa6"
    ACCENT_2 = "#0a7f6f"
    DANGER = "#a63b4e"
    BORDER_DARK = "#6c675c"
    BORDER_LIGHT = "#f8f6f0"
    BUTTON = "#d4d0c8"
    BUTTON_ACTIVE = "#c1bdb4"
    DISABLED = "#b1aca1"
    CONSOLE_BG = "#f3f0e8"
    CONSOLE_TEXT = "#20242c"

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Lanzador de localhost")
        self.root.geometry("1040x720")
        self.root.minsize(960, 660)

        self.base_dir = Path(__file__).resolve().parent
        self.selected_dir = tk.StringVar(value=str(self.base_dir))
        self.selected_project_name = tk.StringVar(value="Ningun proyecto")
        self.status_text = tk.StringVar(value="Selecciona un proyecto")
        self.port = tk.StringVar(value="8000")
        self.url_text = tk.StringVar(value="Sin iniciar")
        self.active_folder_text = tk.StringVar(value="Ninguna carpeta activa")
        self.browser_target_text = tk.StringVar(value="Archivo: -\nRuta: -")
        self.github_url = tk.StringVar(value="")
        self.command_text = tk.StringVar(value="")
        self.has_active_project = False
        self.last_console_response = ""
        self.command_history: list[str] = []
        self.command_history_index = -1
        self.detected_console_commands: list[str] = []

        self.process: subprocess.Popen[str] | None = None
        self.output_thread: threading.Thread | None = None
        self.preconfigured_dirs = self._discover_preconfigured_dirs()
        self.project_buttons: list[ProjectButtonRef] = []
        self.current_view = "project_selection"

        self._configure_window()
        self._build_ui()
        self.show_project_selection_view()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def _configure_window(self) -> None:
        self.root.configure(bg=self.BG)

    def _discover_preconfigured_dirs(self) -> list[Path]:
        directories = [path for path in sorted(self.base_dir.iterdir(), key=lambda item: item.name.lower()) if path.is_dir()]
        if not directories:
            directories.append(self.base_dir)
        return directories

    def _build_ui(self) -> None:
        self.outer = tk.Frame(self.root, bg=self.BG)
        self.outer.pack(fill="both", expand=True, padx=16, pady=16)

        self.selection_view = tk.Frame(self.outer, bg=self.BG)
        self.actions_view = tk.Frame(self.outer, bg=self.BG)

        self._build_selection_view(self.selection_view)
        self._build_actions_view(self.actions_view)

    def _build_selection_view(self, parent: tk.Frame) -> None:
        shell = self._panel_shell(parent)
        shell.outer.pack(fill="both", expand=True)

        body = tk.Frame(shell.inner, bg=self.PANEL)
        body.pack(fill="both", expand=True, padx=18, pady=18)

        header = tk.Frame(body, bg=self.PANEL)
        header.pack(fill="x", pady=(0, 14))
        tk.Label(header, text="Proyectos", bg=self.PANEL, fg=self.TEXT, font=("Tahoma", 16, "bold")).pack(anchor="w")

        project_list_wrap = self._panel_shell(body, inner_bg=self.FIELD)
        project_list_wrap.outer.pack(fill="both", expand=True)

        canvas = tk.Canvas(project_list_wrap.inner, bg=self.FIELD, highlightthickness=0)
        self.project_list_canvas = canvas
        scrollbar = tk.Scrollbar(project_list_wrap.inner, orient="vertical", command=canvas.yview)
        self.project_buttons_frame = tk.Frame(canvas, bg=self.FIELD)

        self.project_buttons_frame.bind("<Configure>", lambda event: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=self.project_buttons_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True, padx=4, pady=4)
        scrollbar.pack(side="right", fill="y", pady=4, padx=(0, 4))

        self._bind_mousewheel(canvas)
        self._bind_mousewheel(self.project_buttons_frame)

        self._render_project_buttons()

        manual_wrap = self._panel_shell(body, inner_bg=self.PANEL_ALT)
        manual_wrap.outer.pack(fill="x", pady=(14, 0))

        tk.Label(manual_wrap.inner, text="Seleccion manual", bg=self.PANEL_ALT, fg=self.TEXT, font=("Tahoma", 10, "bold")).pack(anchor="w", padx=12, pady=(10, 6))

        manual_row = tk.Frame(manual_wrap.inner, bg=self.PANEL_ALT)
        manual_row.pack(fill="x", padx=12, pady=(0, 12))

        self.dir_entry = tk.Entry(
            manual_row,
            textvariable=self.selected_dir,
            bg=self.FIELD,
            fg=self.TEXT,
            insertbackground=self.TEXT,
            relief="sunken",
            bd=2,
            font=("Tahoma", 10),
        )
        self.dir_entry.pack(side="left", fill="x", expand=True, ipady=6)

        browse_button = self._button(manual_row, "Elegir", self.select_directory, self.BUTTON)
        browse_button.pack(side="left", padx=(8, 0))

        enter_manual_button = self._button(manual_row, "Abrir", self.open_manual_project, self.BUTTON)
        enter_manual_button.pack(side="left", padx=(8, 0))

    def _build_actions_view(self, parent: tk.Frame) -> None:
        parent.grid_columnconfigure(0, weight=5)
        parent.grid_columnconfigure(1, weight=4)
        parent.grid_rowconfigure(0, weight=1)

        left = self._panel_shell(parent)
        left.outer.grid(row=0, column=0, sticky="nsew", padx=(0, 12))

        right = self._panel_shell(parent, inner_bg=self.PANEL_ALT)
        right.outer.grid(row=0, column=1, sticky="nsew")

        self._build_actions_left_panel(left.inner)
        self._build_actions_right_panel(right.inner)

    def _build_actions_left_panel(self, parent: tk.Frame) -> None:
        body = tk.Frame(parent, bg=self.PANEL)
        body.pack(fill="both", expand=True, padx=18, pady=18)

        nav_row = tk.Frame(body, bg=self.PANEL)
        nav_row.pack(fill="x", pady=(0, 12))
        self.back_button = self._button(nav_row, "Atras", self.show_project_selection_view, self.BUTTON)
        self.back_button.pack(side="left")

        self._section_title(body, "Proyecto")
        selected_card = self._panel_shell(body, inner_bg=self.FIELD)
        selected_card.outer.pack(fill="x", pady=(6, 14))
        tk.Label(selected_card.inner, textvariable=self.selected_project_name, bg=self.FIELD, fg=self.TEXT, font=("Tahoma", 14, "bold"), anchor="w").pack(fill="x", padx=12, pady=(10, 2))
        tk.Label(selected_card.inner, textvariable=self.active_folder_text, bg=self.FIELD, fg=self.MUTED, font=("Tahoma", 9), anchor="w", justify="left", wraplength=520).pack(fill="x", padx=12, pady=(0, 10))

        controls = tk.Frame(body, bg=self.PANEL)
        controls.pack(fill="x", pady=(0, 12))

        port_card = self._panel_shell(controls, inner_bg=self.FIELD)
        port_card.outer.pack(side="left", fill="x", expand=True)
        tk.Label(port_card.inner, text="Puerto", bg=self.FIELD, fg=self.MUTED, font=("Tahoma", 9, "bold")).pack(anchor="w", padx=12, pady=(10, 4))
        port_row = tk.Frame(port_card.inner, bg=self.FIELD)
        port_row.pack(fill="x", padx=12, pady=(0, 10))

        self.port_entry = tk.Entry(
            port_row,
            textvariable=self.port,
            bg="#ffffff",
            fg=self.TEXT,
            insertbackground=self.TEXT,
            relief="sunken",
            bd=2,
            font=("Tahoma", 16, "bold"),
        )
        self.port_entry.pack(side="left", fill="x", expand=True, ipady=4)

        port_buttons = tk.Frame(port_row, bg=self.FIELD)
        port_buttons.pack(side="left", padx=(8, 0))
        self.port_up_button = self._small_button(port_buttons, "^", self.increase_port)
        self.port_up_button.pack(fill="x")
        self.port_down_button = self._small_button(port_buttons, "v", self.decrease_port)
        self.port_down_button.pack(fill="x", pady=(4, 0))

        url_card = self._panel_shell(controls, inner_bg=self.FIELD)
        url_card.outer.pack(side="left", fill="x", expand=True, padx=(12, 0))
        tk.Label(url_card.inner, text="URL", bg=self.FIELD, fg=self.MUTED, font=("Tahoma", 9, "bold")).pack(anchor="w", padx=12, pady=(10, 4))
        tk.Label(url_card.inner, textvariable=self.url_text, bg=self.FIELD, fg=self.TEXT, font=("Tahoma", 10), anchor="w", justify="left", wraplength=250).pack(fill="x", padx=12, pady=(0, 12))

        self._section_title(body, "Acciones")
        actions_row = tk.Frame(body, bg=self.PANEL)
        actions_row.pack(fill="x", pady=(6, 12))

        self.launch_button = self._button(actions_row, "Iniciar", self.start_selected_server, self.ACCENT, fg="#ffffff")
        self.launch_button.pack(side="left")

        self.stop_button = self._button(actions_row, "Detener", self.stop_server, self.DANGER, fg="#ffffff")
        self.stop_button.pack(side="left", padx=(8, 0))
        self.stop_button.config(state="disabled", bg=self.DISABLED, disabledforeground=self.MUTED)

        refresh_button = self._button(actions_row, "Recargar", self.reload_projects, self.BUTTON)
        refresh_button.pack(side="left", padx=(8, 0))

        change_button = self._button(actions_row, "Cambiar", self.show_project_selection_view, self.BUTTON)
        change_button.pack(side="left", padx=(8, 0))

        status_wrap = self._panel_shell(body, inner_bg=self.FIELD)
        status_wrap.outer.pack(fill="x")
        tk.Label(status_wrap.inner, text="Estado", bg=self.FIELD, fg=self.MUTED, font=("Tahoma", 9, "bold")).pack(anchor="w", padx=12, pady=(10, 4))
        tk.Label(status_wrap.inner, textvariable=self.status_text, bg=self.FIELD, fg=self.TEXT, justify="left", wraplength=520, font=("Tahoma", 10)).pack(anchor="w", padx=12, pady=(0, 10))

        self._section_title(body, "Git")
        git_wrap = self._panel_shell(body, inner_bg=self.FIELD)
        git_wrap.outer.pack(fill="x", pady=(12, 0))

        tk.Label(git_wrap.inner, text="URL de GitHub", bg=self.FIELD, fg=self.MUTED, font=("Tahoma", 9, "bold")).pack(anchor="w", padx=12, pady=(10, 4))
        self.github_entry = tk.Entry(
            git_wrap.inner,
            textvariable=self.github_url,
            bg="#ffffff",
            fg=self.TEXT,
            insertbackground=self.TEXT,
            relief="sunken",
            bd=2,
            font=("Tahoma", 10),
        )
        self.github_entry.pack(fill="x", padx=12, pady=(0, 10), ipady=5)

        self.git_init_row = tk.Frame(git_wrap.inner, bg=self.FIELD)
        self.git_init_row.pack(fill="x", padx=12, pady=(0, 12))
        self.git_init_button = self._button(self.git_init_row, "Git Init", self.git_init_project, self.BUTTON)
        self.git_init_button.pack(side="left")

        git_buttons_row_1 = tk.Frame(git_wrap.inner, bg=self.FIELD)
        git_buttons_row_1.pack(fill="x", padx=12, pady=(0, 8))
        self.git_buttons_row_1 = git_buttons_row_1
        self._button(git_buttons_row_1, "GitHub", self.open_github_url, self.BUTTON).pack(side="left")
        self._button(git_buttons_row_1, "Pull", self.git_pull_project, self.BUTTON).pack(side="left", padx=(8, 0))
        self._button(git_buttons_row_1, "Status", self.git_status_project, self.BUTTON).pack(side="left", padx=(8, 0))

        git_buttons_row_2 = tk.Frame(git_wrap.inner, bg=self.FIELD)
        git_buttons_row_2.pack(fill="x", padx=12, pady=(0, 12))
        self.git_buttons_row_2 = git_buttons_row_2
        self._button(git_buttons_row_2, "Commit", self.git_commit_project, self.BUTTON).pack(side="left")
        self._button(git_buttons_row_2, "Push", self.git_push_project, self.BUTTON).pack(side="left", padx=(8, 0))
        self._button(git_buttons_row_2, "Log", self.git_log_project, self.BUTTON).pack(side="left", padx=(8, 0))

        self._update_git_section()

    def _build_actions_right_panel(self, parent: tk.Frame) -> None:
        body = tk.Frame(parent, bg=self.PANEL_ALT)
        body.pack(fill="both", expand=True, padx=18, pady=18)

        target_wrap = self._panel_shell(body, inner_bg=self.FIELD)
        target_wrap.outer.pack(fill="x", pady=(0, 12))
        tk.Label(target_wrap.inner, text="Archivo al abrir", bg=self.FIELD, fg=self.MUTED, font=("Tahoma", 9, "bold")).pack(anchor="w", padx=12, pady=(10, 4))
        tk.Label(target_wrap.inner, textvariable=self.browser_target_text, bg=self.FIELD, fg=self.TEXT, justify="left", wraplength=320, font=("Tahoma", 10)).pack(anchor="w", padx=12, pady=(0, 10))

        console_wrap = self._panel_shell(body, inner_bg=self.CONSOLE_BG)
        console_wrap.outer.pack(fill="both", expand=True)
        tk.Label(console_wrap.inner, text="Consola", bg=self.CONSOLE_BG, fg=self.MUTED, font=("Tahoma", 9, "bold")).pack(anchor="w", padx=12, pady=(10, 4))

        command_wrap = tk.Frame(console_wrap.inner, bg=self.CONSOLE_BG)
        command_wrap.pack(fill="x", padx=12, pady=(0, 8))

        self.command_entry = tk.Entry(
            command_wrap,
            textvariable=self.command_text,
            bg="#ffffff",
            fg=self.TEXT,
            insertbackground=self.TEXT,
            relief="sunken",
            bd=2,
            font=("Courier New", 10),
        )
        self.command_entry.pack(side="left", fill="x", expand=True, ipady=5)
        self.command_entry.bind("<Return>", lambda event: self.run_manual_command())

        history_buttons = tk.Frame(command_wrap, bg=self.CONSOLE_BG)
        history_buttons.pack(side="left", padx=(8, 0))

        self.command_up_button = self._small_button(history_buttons, "^", self.show_previous_command)
        self.command_up_button.pack(fill="x")
        self.command_down_button = self._small_button(history_buttons, "v", self.show_next_command)
        self.command_down_button.pack(fill="x", pady=(4, 0))

        self.run_command_button = self._button(command_wrap, "Ejecutar", self.run_manual_command, self.BUTTON)
        self.run_command_button.pack(side="left", padx=(8, 0))

        console_text_wrap = tk.Frame(console_wrap.inner, bg=self.CONSOLE_BG)
        console_text_wrap.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        self.output_box = tk.Text(
            console_text_wrap,
            bg=self.CONSOLE_BG,
            fg=self.CONSOLE_TEXT,
            insertbackground=self.CONSOLE_TEXT,
            relief="sunken",
            bd=2,
            wrap="word",
            font=("Courier New", 10),
            state="disabled",
            selectbackground="#b6c8e3",
            padx=10,
            pady=8,
            yscrollcommand=lambda *args: self.console_scrollbar.set(*args),
        )
        self.output_box.pack(side="left", fill="both", expand=True)

        self.console_scrollbar = tk.Scrollbar(console_text_wrap, orient="vertical", command=self.output_box.yview)
        self.console_scrollbar.pack(side="right", fill="y")

        self.console_buttons_frame = tk.Frame(console_wrap.inner, bg=self.CONSOLE_BG)
        self.console_buttons_frame.pack(fill="x", padx=12, pady=(0, 8))

        button_row = tk.Frame(console_wrap.inner, bg=self.CONSOLE_BG)
        button_row.pack(fill="x", padx=12, pady=(0, 12))

        self.copy_last_button = self._button(button_row, "Copiar", self.copy_last_response, self.BUTTON)
        self.copy_last_button.pack(side="right", padx=(0, 8))

        self.open_browser_button = self._button(button_row, "Abrir", self.open_in_browser, self.BUTTON)
        self.open_browser_button.pack(side="right")
        self.open_browser_button.config(state="disabled", bg=self.DISABLED, disabledforeground=self.MUTED)

        self._append_output("Aplicacion lista\n")

    def _panel_shell(self, parent: tk.Widget, inner_bg: str | None = None) -> PanelShell:
        outer = tk.Frame(parent, bg=self.BORDER_DARK, bd=0, highlightthickness=0)
        middle = tk.Frame(outer, bg=self.BORDER_LIGHT, bd=0, highlightthickness=0)
        middle.pack(fill="both", expand=True, padx=(1, 2), pady=(1, 2))
        inner = tk.Frame(middle, bg=inner_bg or self.PANEL, bd=0, highlightthickness=0)
        inner.pack(fill="both", expand=True, padx=1, pady=1)
        return PanelShell(outer=outer, inner=inner)

    def _render_project_buttons(self) -> None:
        for widget in self.project_buttons_frame.winfo_children():
            widget.destroy()
        self.project_buttons.clear()

        for directory in self.preconfigured_dirs:
            card_shell = self._panel_shell(self.project_buttons_frame, inner_bg=self.FIELD)
            card_shell.outer.pack(fill="x", pady=(0, 8))
            card = card_shell.inner

            info = tk.Frame(card, bg=self.FIELD)
            info.pack(side="left", fill="both", expand=True, padx=12, pady=10)
            tk.Label(info, text=directory.name, bg=self.FIELD, fg=self.TEXT, font=("Tahoma", 11, "bold"), anchor="w").pack(fill="x")
            tk.Label(info, text=str(directory), bg=self.FIELD, fg=self.MUTED, font=("Tahoma", 9), anchor="w").pack(fill="x", pady=(4, 0))

            if self.has_active_project and Path(self.selected_dir.get()) == directory:
                button_command = self.show_actions_view
            else:
                button_command = lambda path=directory: self.open_project(path)

            button = self._button(card, "Abrir", button_command, self.BUTTON)
            button.pack(side="right", padx=12, pady=10)
            self.project_buttons.append(ProjectButtonRef(button=button, path=directory))

    def _button(self, parent: tk.Widget, text: str, command: Callable[[], object], bg: str, fg: str | None = None) -> tk.Button:
        button = tk.Button(
            parent,
            text=text,
            command=command,
            bg=bg,
            fg=fg or self.TEXT,
            activebackground=self.BUTTON_ACTIVE,
            activeforeground=fg or self.TEXT,
            relief="raised",
            bd=2,
            cursor="hand2",
            font=("Tahoma", 9),
            padx=14,
            pady=6,
        )
        return button

    def _small_button(self, parent: tk.Widget, text: str, command: Callable[[], object]) -> tk.Button:
        button = tk.Button(
            parent,
            text=text,
            command=command,
            bg=self.BUTTON,
            fg=self.TEXT,
            activebackground=self.BUTTON_ACTIVE,
            activeforeground=self.TEXT,
            relief="raised",
            bd=2,
            cursor="hand2",
            font=("Tahoma", 8, "bold"),
            width=3,
            padx=0,
            pady=1,
        )
        return button

    def _section_title(self, parent: tk.Frame, text: str) -> None:
        tk.Label(parent, text=text, bg=parent.cget("bg"), fg=self.MUTED, font=("Tahoma", 9, "bold")).pack(anchor="w")

    def _bind_mousewheel(self, widget: tk.Widget) -> None:
        widget.bind("<MouseWheel>", self._on_mousewheel)

    def _on_mousewheel(self, event: tk.Event) -> str:
        if hasattr(self, "project_list_canvas"):
            self.project_list_canvas.yview_scroll(int(-event.delta / 120), "units")
        return "break"

    def select_directory(self) -> None:
        folder = filedialog.askdirectory(initialdir=self.selected_dir.get() or str(self.base_dir))
        if folder:
            self.selected_dir.set(folder)
            self.status_text.set("Carpeta manual lista")

    def open_manual_project(self) -> None:
        directory = Path(self.selected_dir.get()).expanduser()
        if not directory.exists() or not directory.is_dir():
            messagebox.showerror("Carpeta invalida", "Selecciona un directorio valido.")
            return
        self.open_project(directory, manual=True)

    def open_project(self, directory: Path, manual: bool = False) -> None:
        self.selected_dir.set(str(directory))
        self.selected_project_name.set(directory.name or str(directory))
        self.active_folder_text.set(str(directory))
        self.has_active_project = True
        self.browser_target_text.set("Archivo: index.html\nRuta: " + str(directory / "index.html"))
        self._update_git_section()
        if manual:
            self.status_text.set("Proyecto manual cargado")
        else:
            self.status_text.set("Proyecto cargado")
        self.show_actions_view()

    def show_project_selection_view(self) -> None:
        if self.process is not None:
            self.status_text.set("Servidor en ejecucion")
        self.actions_view.pack_forget()
        self.selection_view.pack(fill="both", expand=True)
        self.current_view = "project_selection"

    def show_actions_view(self) -> None:
        if not self.has_active_project:
            return
        self.selection_view.pack_forget()
        self.actions_view.pack(fill="both", expand=True)
        self.current_view = "actions"

    def start_selected_server(self) -> None:
        self.start_server(Path(self.selected_dir.get()).expanduser())

    def start_server(self, directory: Path) -> None:
        port = self._parse_port()

        if self.process is not None:
            messagebox.showinfo("Servidor activo", "Ya hay un servidor en ejecucion.")
            return

        if not directory.exists() or not directory.is_dir():
            messagebox.showerror("Carpeta invalida", "Selecciona un directorio valido.")
            return

        if port is None:
            messagebox.showerror("Puerto invalido", "Introduce un puerto entre 1 y 65535.")
            return

        if not self._port_available(port):
            messagebox.showerror("Puerto ocupado", f"El puerto {port} ya esta en uso.")
            return

        command = [sys.executable, "-m", "http.server", str(port), "--directory", os.fspath(directory)]
        self.process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )

        self.selected_dir.set(str(directory))
        self.selected_project_name.set(directory.name or str(directory))
        self.active_folder_text.set(str(directory))
        self.has_active_project = True
        self.url_text.set(f"http://127.0.0.1:{port}/")
        self.browser_target_text.set("Archivo: index.html\nRuta: " + str(directory / "index.html"))
        self.status_text.set(f"Servidor activo en {port}")
        self.command_text.set("python -m http.server " + str(port) + " --directory \"" + os.fspath(directory) + "\"")
        self._remember_command(self.command_text.get())
        self.launch_button.config(state="disabled", bg=self.DISABLED, disabledforeground=self.MUTED)
        self.stop_button.config(state="normal", bg=self.DANGER, fg="#ffffff")
        self.open_browser_button.config(state="normal", bg=self.BUTTON, fg=self.TEXT)
        self._set_project_buttons_state("disabled")
        self._append_output(f"Proyecto: {directory}\nURL: http://127.0.0.1:{port}/\n")

        self.output_thread = threading.Thread(target=self._read_output, daemon=True)
        self.output_thread.start()

    def stop_server(self) -> None:
        if self.process is None:
            return

        self.process.terminate()
        self.process.wait(timeout=5)
        self.process = None
        self.url_text.set("Sin iniciar")
        self.status_text.set("Servidor detenido")
        self.launch_button.config(state="normal", bg=self.ACCENT, fg="#ffffff")
        self.stop_button.config(state="disabled", bg=self.DISABLED, disabledforeground=self.MUTED)
        self.open_browser_button.config(state="disabled", bg=self.DISABLED, disabledforeground=self.MUTED)
        self._set_project_buttons_state("normal")
        self._append_output("Servidor detenido\n")

    def reload_projects(self) -> None:
        self.preconfigured_dirs = self._discover_preconfigured_dirs()
        self._render_project_buttons()
        self._update_git_section()
        self.status_text.set("Lista recargada")

    def open_in_browser(self) -> None:
        if self.process is None:
            return
        index_path = Path(self.selected_dir.get()) / "index.html"
        base_url = self.url_text.get().rstrip("/")
        target_url = f"{base_url}/index.html"
        self.command_text.set(f"start {target_url}")
        self._remember_command(self.command_text.get())
        self.browser_target_text.set(f"Archivo: index.html\nRuta: {index_path}")
        self._append_output(f"Abrir archivo: index.html\nRuta: {index_path}\n")
        webbrowser.open(target_url)

    def open_github_url(self) -> None:
        url = self.github_url.get().strip()
        if not url:
            messagebox.showerror("URL vacia", "Introduce la URL del proyecto de GitHub.")
            return
        self.command_text.set(f"start {url}")
        self._remember_command(self.command_text.get())
        webbrowser.open(url)
        self._append_output(f"Abrir GitHub: {url}\n")

    def git_pull_project(self) -> None:
        self._run_git_command("pull", "git pull")

    def git_init_project(self) -> None:
        self._run_git_command("init", "git init")
        self._update_git_section()

    def git_status_project(self) -> None:
        self._run_git_command("status", "git status")

    def git_commit_project(self) -> None:
        self._run_git_command("commit", "git add . && git commit -m \"Update from launcher\"")

    def git_push_project(self) -> None:
        self._run_git_command("push", "git push")

    def git_log_project(self) -> None:
        self._run_git_command("log", "git log --oneline -5")

    def _run_git_command(self, label: str, command: str) -> None:
        project_dir = Path(self.selected_dir.get())
        if not project_dir.exists() or not project_dir.is_dir():
            messagebox.showerror("Proyecto invalido", "Selecciona un proyecto valido.")
            return

        self.command_text.set(command)
        self._remember_command(command)

        try:
            result = subprocess.run(
                command,
                cwd=project_dir,
                shell=True,
                capture_output=True,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except Exception as exc:
            self._append_output(f"Git {label}: error {exc}\n")
            return

        self._append_output(f"Git {label}:\n")
        if result.stdout:
            self._append_output(result.stdout.strip() + "\n")
        if result.stderr:
            self._append_output(result.stderr.strip() + "\n")

    def _update_git_section(self) -> None:
        project_dir = Path(self.selected_dir.get())
        has_git = project_dir.is_dir() and (project_dir / ".git").exists()

        if has_git:
            self.git_init_row.pack_forget()
            self.git_buttons_row_1.pack(fill="x", padx=12, pady=(0, 8))
            self.git_buttons_row_2.pack(fill="x", padx=12, pady=(0, 12))
        else:
            self.git_buttons_row_1.pack_forget()
            self.git_buttons_row_2.pack_forget()
            self.git_init_row.pack(fill="x", padx=12, pady=(0, 12))

    def run_manual_command(self) -> None:
        command = self.command_text.get().strip()
        project_dir = Path(self.selected_dir.get())

        if not command:
            return
        if not project_dir.exists() or not project_dir.is_dir():
            messagebox.showerror("Proyecto invalido", "Selecciona un proyecto valido.")
            return

        self._remember_command(command)
        self._append_output(f"> {command}\n")
        try:
            result = subprocess.run(
                command,
                cwd=project_dir,
                shell=True,
                capture_output=True,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except Exception as exc:
            self._append_output(f"Error: {exc}\n")
            return

        if result.stdout:
            self._append_output(result.stdout.strip() + "\n")
        if result.stderr:
            self._append_output(result.stderr.strip() + "\n")

    def increase_port(self) -> None:
        port = self._parse_port(default=8000)
        if port is None:
            port = 8000
        if port < 65535:
            self.port.set(str(port + 1))

    def decrease_port(self) -> None:
        port = self._parse_port(default=8000)
        if port is None:
            port = 8000
        if port > 1:
            self.port.set(str(port - 1))

    def _read_output(self) -> None:
        if self.process is None or self.process.stdout is None:
            return

        for line in self.process.stdout:
            self.root.after(0, self._append_output, line.rstrip("\n") + "\n")

        self.root.after(0, self._handle_server_exit)

    def _handle_server_exit(self) -> None:
        if self.process is not None and self.process.poll() is None:
            return

        self.process = None
        self.url_text.set("Sin iniciar")
        self.launch_button.config(state="normal", bg=self.ACCENT, fg="#ffffff")
        self.stop_button.config(state="disabled", bg=self.DISABLED, disabledforeground=self.MUTED)
        self.open_browser_button.config(state="disabled", bg=self.DISABLED, disabledforeground=self.MUTED)
        self._set_project_buttons_state("normal")
        if "detenido" not in self.status_text.get().lower():
            self.status_text.set("Proceso finalizado")

    def _set_project_buttons_state(self, state: Literal["normal", "disabled"]) -> None:
        for project_button in self.project_buttons:
            current_path = Path(self.selected_dir.get()) if self.selected_dir.get() else None
            if state == "disabled" and self.has_active_project and project_button.path == current_path:
                project_button.button.config(state="normal")
            else:
                project_button.button.config(state=state)

    def _append_output(self, text: str) -> None:
        stripped = text.strip()
        if stripped:
            self.last_console_response = stripped
        self.output_box.config(state="normal")
        self.output_box.insert("end", text)
        self.output_box.see("end")
        self.output_box.config(state="disabled")
        self._update_console_command_buttons(text)

    def copy_last_response(self) -> None:
        if not self.last_console_response:
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(self.last_console_response)
        self.status_text.set("Ultima respuesta copiada")

    def _parse_port(self, default: int | None = None) -> int | None:
        try:
            port = int(self.port.get())
        except ValueError:
            return default
        return port if 1 <= port <= 65535 else None

    @staticmethod
    def _port_available(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            return sock.connect_ex(("127.0.0.1", port)) != 0

    def on_close(self) -> None:
        if self.process is not None:
            self.stop_server()
        self.root.destroy()

    def _remember_command(self, command: str) -> None:
        cleaned = command.strip()
        if not cleaned:
            return
        if cleaned in self.command_history:
            self.command_history.remove(cleaned)
        self.command_history.append(cleaned)
        self.command_history = self.command_history[-10:]
        self.command_history_index = len(self.command_history)

    def show_previous_command(self) -> None:
        if not self.command_history:
            return
        if self.command_history_index > 0:
            self.command_history_index -= 1
        self.command_text.set(self.command_history[self.command_history_index])

    def show_next_command(self) -> None:
        if not self.command_history:
            return
        if self.command_history_index < len(self.command_history) - 1:
            self.command_history_index += 1
            self.command_text.set(self.command_history[self.command_history_index])
        else:
            self.command_history_index = len(self.command_history)
            self.command_text.set("")

    def _update_console_command_buttons(self, text: str) -> None:
        commands = self._extract_commands(text)
        if not commands:
            return

        self.detected_console_commands = commands[-5:]
        for widget in self.console_buttons_frame.winfo_children():
            widget.destroy()

        for command in self.detected_console_commands:
            row = tk.Frame(self.console_buttons_frame, bg=self.CONSOLE_BG)
            row.pack(fill="x", pady=(0, 6))
            tk.Label(row, text=command, bg=self.CONSOLE_BG, fg=self.CONSOLE_TEXT, anchor="w", justify="left", font=("Courier New", 9)).pack(side="left", fill="x", expand=True)
            self._button(row, "Ejecutar comando", lambda cmd=command: self.run_detected_command(cmd), self.BUTTON).pack(side="right", padx=(8, 0))

    def _extract_commands(self, text: str) -> list[str]:
        commands: list[str] = []
        patterns = [
            r"(?:comando|command)\s*:\s*(.+)",
            r"(?:ejecuta|execute|run)\s+`([^`]+)`",
            r"(?:ejecuta|execute|run)\s+(.+)",
        ]

        for line in text.splitlines():
            stripped = line.strip()
            for pattern in patterns:
                match = re.search(pattern, stripped, re.IGNORECASE)
                if match:
                    candidate = match.group(1).strip().strip(".")
                    if candidate and len(candidate) < 200:
                        commands.append(candidate)
                    break
        return commands

    def run_detected_command(self, command: str) -> None:
        self.command_text.set(command)
        self.run_manual_command()


def main() -> None:
    root = tk.Tk()
    app = ServerLauncherApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
