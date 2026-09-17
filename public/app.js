const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

(function initParticles() {
  const container = document.getElementById("particles");
  if (!container) return;
  for (let i = 0; i < 40; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    p.style.left = Math.random() * 100 + "%";
    p.style.animationDuration = (Math.random() * 15 + 10) + "s";
    p.style.animationDelay = (Math.random() * 10) + "s";
    p.style.opacity = Math.random() * 0.5 + 0.2;
    container.appendChild(p);
  }
})();

if ($("#loginForm")) {
  $$(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      $$(".form").forEach(f => f.classList.remove("active"));
      $("#" + tab.dataset.tab + "Form").classList.add("active");
    });
  });

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#message");
    msg.textContent = "Connexion...";
    msg.className = "message";
    const { ok, data } = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: $("#loginUser").value, password: $("#loginPass").value })
    });
    if (ok) {
      msg.textContent = "Connecte !";
      msg.className = "message success";
      setTimeout(() => location.href = "/dashboard.html", 500);
    } else {
      msg.textContent = data.error || "Erreur";
      msg.className = "message error";
    }
  });

  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#message");
    msg.textContent = "Creation...";
    msg.className = "message";
    const { ok, data } = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({ username: $("#regUser").value, password: $("#regPass").value })
    });
    if (ok) {
      msg.textContent = "Compte cree !";
      msg.className = "message success";
      setTimeout(() => location.href = "/dashboard.html", 700);
    } else {
      msg.textContent = data.error || "Erreur";
      msg.className = "message error";
    }
  });

  api("/api/me").then(({ ok }) => { if (ok) location.href = "/dashboard.html"; });
}

if ($("#dropZone")) {
  let selectedFile = null;
  let selectedScriptId = null;

  api("/api/me").then(({ ok, data }) => {
    if (!ok) return location.href = "/";
    $("#userBadge").textContent = data.username + " (" + data.role.toUpperCase() + ")";
    setTimeout(() => { const ws = $("#welcomeScreen"); if (ws) ws.classList.add("hidden"); }, 1500);
  });

  $$(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $$(".nav-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      $$(".page").forEach(p => p.classList.remove("active"));
      $("#page-" + tab.dataset.page).classList.add("active");
      if (tab.dataset.page === "logs") loadLogs();
      if (tab.dataset.page === "ban") loadBannedUsers();
      if (tab.dataset.page === "keys" && selectedScriptId) loadKeys(selectedScriptId);
    });
  });

  async function loadStats() {
    const { ok, data } = await api("/api/stats");
    if (!ok) return;
    $("#statScripts").textContent = data.scripts;
    $("#statKeys").textContent = data.keys;
    $("#statActive").textContent = data.activeKeys;
    $("#statBanned").textContent = data.banned;
    $("#statLogs").textContent = data.logs;
  }

  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    location.href = "/";
  });

  const dropZone = $("#dropZone");
  const fileInput = $("#fileInput");

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

  function handleFile(file) {
    selectedFile = file;
    $("#fileInfo").textContent = file.name + " (" + (file.size/1024).toFixed(1) + " Ko)";
    checkReady();
  }

  $("#scriptName").addEventListener("input", checkReady);
  function checkReady() {
    $("#publishBtn").disabled = !(selectedFile && $("#scriptName").value.length > 0);
  }

  $("#publishBtn").addEventListener("click", async () => {
    const fd = new FormData();
    fd.append("script", selectedFile);
    fd.append("name", $("#scriptName").value);
    fd.append("is_public", $("#scriptPublic").checked ? "1" : "0");
    fd.append("description", $("#scriptDesc").value || "");

    $("#publishBtn").disabled = true;
    $("#publishBtn").textContent = "Publication...";

    const res = await fetch("/api/upload", { method: "POST", credentials: "include", body: fd });
    const data = await res.json();

    if (res.ok) {
      const pageUrl = location.origin + "/script/" + data.scriptId;
      $("#resultBox").classList.add("show");
      $("#resultBox").innerHTML =
        '<div style="color:#fff;font-weight:bold;margin-bottom:10px;">Script publie !</div>' +
        '<div style="color:#888;font-size:11px;margin-bottom:8px;">Page publique :</div>' +
        '<textarea readonly>' + pageUrl + '</textarea>' +
        '<button class="btn-primary" style="margin-top:10px;" id="copyPageBtn">Copier le lien</button>';
      document.getElementById("copyPageBtn").addEventListener("click", function() {
        navigator.clipboard.writeText(pageUrl);
        this.textContent = "Copie !";
        setTimeout(() => this.textContent = "Copier le lien", 1500);
      });
      selectedFile = null;
      $("#fileInfo").textContent = "";
      $("#scriptName").value = "";
      $("#scriptDesc").value = "";
      $("#scriptPublic").checked = false;
      loadScripts();
      loadStats();
    } else {
      alert("Erreur : " + (data.error || "inconnue"));
    }

    $("#publishBtn").textContent = "Publier";
    checkReady();
  });

  $("#banUserBtn").addEventListener("click", async () => {
    const id = $("#banUserId").value.trim();
    const name = $("#banUserName").value.trim();
    const reason = $("#banReason").value.trim() || "No reason";
    if (!id) return alert("ID Roblox requis");
    const { ok, data } = await api("/api/ban-user", {
      method: "POST",
      body: JSON.stringify({ roblox_id: id, roblox_user: name, reason })
    });
    if (ok) {
      $("#banUserId").value = "";
      $("#banUserName").value = "";
      $("#banReason").value = "";
      loadBannedUsers();
      loadStats();
    }
  });

  async function loadBannedUsers() {
    const { ok, data } = await api("/api/banned-users");
    const list = $("#bannedList");
    if (!ok || !data.length) {
      list.innerHTML = '<p class="small" style="color:#666;font-size:12px;">Aucun utilisateur banni.</p>';
      return;
    }
    list.innerHTML = data.map(u =>
      '<div class="script-item" style="padding:10px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div>' +
            '<div style="font-weight:600;font-size:13px;">' + (u.roblox_user || u.roblox_id) + '</div>' +
            '<div style="font-size:11px;color:#888;">ID: ' + u.roblox_id + ' - ' + (u.reason || 'No reason') + '</div>' +
          '</div>' +
          '<button class="btn-delete" data-id="' + u.roblox_id + '" style="padding:5px 10px;font-size:11px;border:none;border-radius:6px;cursor:pointer;color:#ff5050;background:rgba(255,80,80,0.15);">Debannir</button>' +
        '</div>' +
      '</div>'
    ).join("");
    list.querySelectorAll(".btn-delete").forEach(b => {
      b.addEventListener("click", async () => {
        if (!confirm("Debannir ?")) return;
        await api("/api/ban-user/" + b.dataset.id, { method: "DELETE" });
        loadBannedUsers();
        loadStats();
      });
    });
  }

  async function loadLogs() {
    const { ok, data } = await api("/api/logs");
    const list = $("#logsList");
    if (!ok || !data.length) {
      list.innerHTML = '<p class="small" style="color:#666;font-size:12px;">Aucun log.</p>';
      return;
    }
    list.innerHTML = data.map(l => {
      const date = new Date(l.created_at);
      const timeStr = date.toLocaleString("fr-FR");
      const avatar = l.avatar || "https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=png";
      const status = l.success ? "success" : "fail";
      const statusTxt = l.success ? "SUCCESS" : (l.reason || "FAIL").toUpperCase();
      return '<div class="log-item">' +
        '<img class="log-avatar" src="' + avatar + '" onerror="this.src=\'https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=png\'">' +
        '<div class="log-info">' +
          '<div class="log-user">' + (l.roblox_user || "Unknown") + ' <span style="font-size:11px;color:#666;">(ID: ' + (l.roblox_id || "?") + ')</span></div>' +
          '<div class="log-meta">' +
            '<span>' + timeStr + '</span>' +
            '<span>Script: ' + (l.script_name || l.script_id || "?") + '</span>' +
            '<span>Place: ' + (l.place_id || "?") + '</span>' +
          '</div>' +
          '<div class="log-key">Key: ' + (l.key || "none") + '</div>' +
        '</div>' +
        '<div class="log-status ' + status + '">' + statusTxt + '</div>' +
      '</div>';
    }).join("");
  }

  $("#refreshLogsBtn").addEventListener("click", loadLogs);

  async function loadScripts() {
    const { ok, data } = await api("/api/scripts");
    const list = $("#scriptsList");
    if (!ok || !data.length) {
      list.innerHTML = '<p class="small" style="color:#666;font-size:12px;">Aucun script publie.</p>';
      return;
    }
    list.innerHTML = data.map(s => {
      const pub = s.is_public ? '<span class="badge badge-public">PUBLIC</span>' : '<span class="badge badge-private">PRIVE</span>';
      const owner = s.owner_name ? '<span style="color:#666;font-size:10px;">by ' + s.owner_name + '</span>' : '';
      return '<div class="script-item" data-id="' + s.id + '">' +
        '<div class="name">' + s.name + ' ' + pub + ' ' + owner + '</div>' +
        '<div class="url">ID: ' + s.id + ' - ' + (s.key_count || 0) + ' keys - ' + (s.exec_count || 0) + ' exec</div>' +
        '<div class="actions">' +
          '<button class="btn-select" data-id="' + s.id + '">Cles</button>' +
          '<button class="btn-copy" data-page="' + s.id + '">Page</button>' +
          '<button class="btn-copy" data-loader="' + s.id + '">Loader</button>' +
          '<button class="btn-public" data-id="' + s.id + '" data-public="' + s.is_public + '">' + (s.is_public ? 'Prive' : 'Public') + '</button>' +
          '<button class="btn-delete" data-id="' + s.id + '">Suppr</button>' +
        '</div>' +
      '</div>';
    }).join("");

    list.querySelectorAll(".btn-select").forEach(b => b.addEventListener("click", () => {
      selectScript(b.dataset.id);
      $$(".nav-tab").forEach(t => t.classList.remove("active"));
      document.querySelector('.nav-tab[data-page="keys"]').classList.add("active");
      $$(".page").forEach(p => p.classList.remove("active"));
      $("#page-keys").classList.add("active");
    }));

    list.querySelectorAll(".btn-copy").forEach(b => {
      b.addEventListener("click", () => {
        if (b.dataset.page) {
          navigator.clipboard.writeText(location.origin + "/script/" + b.dataset.page);
          b.textContent = "Copie !";
          setTimeout(() => b.textContent = "Page", 1500);
        } else if (b.dataset.loader) {
          const url = location.origin + "/api/loader/" + b.dataset.loader;
          navigator.clipboard.writeText('loadstring(game:HttpGet("' + url + '"))()');
          b.textContent = "Copie !";
          setTimeout(() => b.textContent = "Loader", 1500);
        }
      });
    });

    list.querySelectorAll(".btn-public").forEach(b => {
      b.addEventListener("click", async () => {
        const isPublic = b.dataset.public === "1";
        await api("/api/script/" + b.dataset.id + "/public", {
          method: "PUT",
          body: JSON.stringify({ is_public: !isPublic })
        });
        loadScripts();
      });
    });

    list.querySelectorAll(".btn-delete").forEach(b => {
      b.addEventListener("click", async () => {
        if (!confirm("Supprimer ce script et toutes ses cles ?")) return;
        await api("/api/script/" + b.dataset.id, { method: "DELETE" });
        if (selectedScriptId === b.dataset.id) {
          selectedScriptId = null;
          $("#keysList").innerHTML = "";
          $("#keyGenBox").style.display = "none";
          $("#selectedScriptInfo").textContent = "Selectionne un script.";
        }
        loadScripts();
        loadStats();
      });
    });
  }

  async function selectScript(scriptId) {
    selectedScriptId = scriptId;
    $$(".script-item").forEach(el => el.classList.remove("selected"));
    const el = document.querySelector('.script-item[data-id="' + scriptId + '"]');
    if (el) el.classList.add("selected");
    $("#selectedScriptInfo").innerHTML = 'Script : <b style="color:#fff">' + scriptId + '</b>';
    $("#keyGenBox").style.display = "block";
    loadKeys(scriptId);
  }

  async function loadKeys(scriptId) {
    const { ok, data } = await api("/api/keys/" + scriptId);
    const list = $("#keysList");
    if (!ok || !data.length) {
      list.innerHTML = '<p class="small" style="color:#666;font-size:12px;">Aucune cle.</p>';
      return;
    }
    list.innerHTML = data.map(k => {
      let badgeClass = "key-badge";
      let typeBadge = "";
      let timeInfo = "";

      if (k.banned) {
        badgeClass += " banned";
      } else if (k.expires_at) {
        const expDate = new Date(k.expires_at);
        const now = new Date();
        if (expDate < now) {
          badgeClass += " expired";
        }
        const hoursLeft = Math.max(0, Math.round((expDate - now) / 3600000));
        timeInfo = '<span style="font-size:11px;color:' + (expDate < now ? '#ff5050' : '#ffb428') + ';margin-left:8px;">' + (expDate < now ? 'EXPIREE' : hoursLeft + 'h restantes') + '</span>';
      }

      typeBadge = k.key_type === 'time' ? '<span class="badge badge-time">TIME</span>' : '<span class="badge badge-perm">PERM</span>';
      const usesInfo = k.max_uses > 0 ? ' <span style="font-size:11px;color:#888;">(' + k.used_count + '/' + k.max_uses + ')</span>' : (k.used_count > 0 ? ' <span style="font-size:11px;color:#888;">(' + k.used_count + ' util)</span>' : '');

      return '<div class="script-item">' +
        '<div>' +
          '<span class="' + badgeClass + '">' + k.key + '</span>' +
          typeBadge + ' ' +
          '<span style="font-size:11px;color:#888;">' + (k.user_label || 'user') + '</span>' +
          usesInfo + timeInfo +
          (k.roblox_id ? ' <span style="font-size:11px;color:#3ce664;">lie ' + k.roblox_id + '</span>' : '') +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn-copy" data-key="' + k.key + '">Copier</button>' +
          '<button class="btn-ban" data-key="' + k.key + '" data-banned="' + k.banned + '">' + (k.banned ? 'Debannir' : 'Bannir') + '</button>' +
          '<button class="btn-delete" data-key="' + k.key + '">Suppr</button>' +
        '</div>' +
      '</div>';
    }).join("");

    list.querySelectorAll(".btn-copy").forEach(b => b.addEventListener("click", () => {
      navigator.clipboard.writeText(b.dataset.key);
      b.textContent = "Copie !";
      setTimeout(() => b.textContent = "Copier", 1500);
    }));
    list.querySelectorAll(".btn-ban").forEach(b => b.addEventListener("click", async () => {
      const banned = b.dataset.banned === "1";
      await api("/api/key/" + b.dataset.key + "/ban", {
        method: "PUT",
        body: JSON.stringify({ banned: !banned })
      });
      loadKeys(scriptId);
    }));
    list.querySelectorAll(".btn-delete").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("Supprimer cette cle ?")) return;
      await api("/api/key/" + b.dataset.key, { method: "DELETE" });
      loadKeys(scriptId);
    }));
  }

  $("#generateKeyBtn").addEventListener("click", async () => {
    if (!selectedScriptId) return;
    const label = $("#userLabel").value || "user";
    const keyType = $("#keyType").value;
    const hours = $("#keyHours").value;
    const maxUses = $("#keyMaxUses").value;

    const { ok, data } = await api("/api/key/generate", {
      method: "POST",
      body: JSON.stringify({
        scriptId: selectedScriptId,
        userLabel: label,
        keyType: keyType,
        expiresIn: keyType === "time" ? hours : null,
        maxUses: maxUses
      })
    });
    if (ok) {
      $("#userLabel").value = "";
      loadKeys(selectedScriptId);
      loadStats();
      navigator.clipboard.writeText(data.key);
      let msg = "Cle generee et copiee :\n" + data.key;
      if (data.expires_at) {
        msg += "\nExpire : " + new Date(data.expires_at).toLocaleString("fr-FR");
      }
      alert(msg);
    }
  });

  $("#keyType").addEventListener("change", (e) => {
    $("#keyHours").disabled = e.target.value !== "time";
  });
  $("#keyHours").disabled = true;

  loadScripts();
  loadBannedUsers();
  loadStats();
}
