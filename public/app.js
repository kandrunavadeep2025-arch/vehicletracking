
const API_URL = "http://localhost:5000";
const TOKEN_KEY = "vehicleTrackingToken";
const USER_KEY = "vehicleTrackingUser";

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
    if (options.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }
    return fetch(url, { ...options, headers });
}

async function readResponse(response) {
    const text = await response.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { error: text || "Unexpected server response" };
    }

    if (response.status === 401 || response.status === 403) {
        logoutUser("Your session has expired. Please log in again.");
        throw new Error("Session expired");
    }
    if (!response.ok) {
        throw new Error(data.error || data.message || "Request failed");
    }
    return data;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    })[character]);
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? 0;
}

function showError(id, message) {
    const element = document.getElementById(id);
    if (element) element.textContent = message;
}

function showAuthMessage(message, isError = false) {
    const element = document.getElementById("authMessage");
    if (element) {
        element.textContent = message || "";
        element.style.color = isError ? "#c62828" : "#2e7d32";
    }
}

function showAuthForm(formId) {
    document.getElementById("loginForm").classList.toggle(
        "hidden", formId !== "loginForm"
    );
    document.getElementById("registerForm").classList.toggle(
        "hidden", formId !== "registerForm"
    );
    showAuthMessage("");
}

async function registerUser() {
    const name = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const phone = document.getElementById("registerPhone").value.trim();
    const password = document.getElementById("registerPassword").value;

    if (!name || !email || !password) {
        showAuthMessage("Enter your name, email and password.", true);
        return;
    }
    if (password.length < 8) {
        showAuthMessage("Password must be at least 8 characters.", true);
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, phone, password })
        });
        const data = await readResponse(response);

        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        location.reload();
    } catch (error) {
        if (error.message !== "Session expired") {
            showAuthMessage(error.message, true);
        }
    }
}

async function loginUser() {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!email || !password) {
        showAuthMessage("Enter your email and password.", true);
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        const data = await readResponse(response);

        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        location.reload();
    } catch (error) {
        if (error.message !== "Session expired") {
            showAuthMessage(error.message, true);
        }
    }
}

function logoutUser(message = "") {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (message) sessionStorage.setItem("logoutMessage", message);
    location.reload();
}

function addAccountBar() {
    const app = document.getElementById("appContent");
    if (!app || document.getElementById("accountBar")) return;

    let user = {};
    try {
        user = JSON.parse(localStorage.getItem(USER_KEY) || "{}");
    } catch {
        user = {};
    }

    const bar = document.createElement("div");
    bar.id = "accountBar";
    bar.className = "account-bar";

    const label = document.createElement("span");
    label.textContent = `Logged in as ${user.name || user.email || "User"}`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Log out";
    button.addEventListener("click", () => logoutUser());

    bar.append(label, button);
    app.insertBefore(bar, app.firstChild);
}

function formatDate(value) {
    if (!value) return "—";
    const parts = String(value).slice(0, 10).split("-");
    if (parts.length !== 3) return String(value);
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function money(value) {
    if (value === null || value === undefined || value === "") return "—";
    return "₹" + Number(value).toLocaleString("en-IN");
}

function renderTable(elementId, rows, columns, emptyMessage) {
    const element = document.getElementById(elementId);
    if (!element) return;

    if (!Array.isArray(rows) || rows.length === 0) {
        element.textContent = emptyMessage;
        return;
    }

    const table = document.createElement("table");
    table.className = "data-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    columns.forEach(column => {
        const th = document.createElement("th");
        th.textContent = column.label;
        headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    rows.forEach(row => {
        const tr = document.createElement("tr");

        columns.forEach(column => {
            const td = document.createElement("td");
            const value = column.render ? column.render(row) : row[column.key];
            td.textContent = value === null || value === undefined || value === ""
                ? "—"
                : String(value);
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    element.replaceChildren(table);
}

function makeButton(label, callback, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (className) button.className = className;
    button.addEventListener("click", callback);
    return button;
}

function makeParagraph(label, value) {
    const p = document.createElement("p");
    p.textContent = `${label}: ${value ?? "—"}`;
    return p;
}

function showSection(sectionId) {
    document.querySelectorAll(".section").forEach(section => {
        section.classList.toggle("hidden", section.id !== sectionId);
    });

    const loaders = {
        dashboard: loadDashboard,
        vehicles: loadVehicles,
        license: loadLicenses,
        puc: loadPUC,
        vehicleProfile: null,
        service: loadServices,
        alerts: loadAlerts
    };

    if (loaders[sectionId]) loaders[sectionId]();
}

// DASHBOARD

async function loadDashboard() {
    try {
        const data = await readResponse(
            await apiFetch(`${API_URL}/api/dashboard`)
        );

        setText("vehicleCount", data.vehicles);
        setText("licenseAlerts", data.licenseAlerts);
        setText("pucAlerts", data.pucAlerts);
        setText("serviceCount", data.serviceRecords);
        setText("pendingAlerts", data.pendingAlerts);

        // Also load live expiry reminders.
        await loadAlerts(true);
    } catch (error) {
        if (error.message !== "Session expired") {
            console.error("Dashboard error:", error);
        }
    }
}

// VEHICLE DROPDOWNS

async function populateVehicleDropdowns() {
    try {
        const vehicles = await readResponse(
            await apiFetch(`${API_URL}/api/vehicles`)
        );

        const select = document.getElementById("serviceVehicleId");
        if (select) {
            const previousValue = select.value;
            select.replaceChildren();

            const first = document.createElement("option");
            first.value = "";
            first.textContent = "Select a vehicle";
            select.appendChild(first);

            vehicles.forEach(vehicle => {
                const option = document.createElement("option");
                option.value = vehicle.vehicle_id;
                option.textContent =
                    `${vehicle.registration_number} (ID ${vehicle.vehicle_id})`;
                select.appendChild(option);
            });

            if (previousValue) select.value = previousValue;
        }
        return vehicles;
    } catch (error) {
        if (error.message !== "Session expired") console.error(error);
        return [];
    }
}

// VEHICLES

async function loadVehicles() {
    const list = document.getElementById("vehicleList");
    if (!list) return;

    try {
        const vehicles = await readResponse(
            await apiFetch(`${API_URL}/api/vehicles`)
        );

        list.replaceChildren();

        if (!Array.isArray(vehicles) || vehicles.length === 0) {
            list.textContent = "No vehicles found. Add your first vehicle above.";
            await populateVehicleDropdowns();
            return;
        }

        vehicles.forEach(vehicle => {
            const card = document.createElement("div");
            card.className = "vehicle-card";

            const title = document.createElement("h3");
            title.textContent = vehicle.registration_number || "Vehicle";
            card.appendChild(title);

            [
                ["Type", vehicle.vehicle_type],
                ["Brand", vehicle.brand],
                ["Model", vehicle.model],
                ["Year", vehicle.manufacturing_year],
                ["Owner", vehicle.owner_name]
            ].forEach(([label, value]) => {
                card.appendChild(makeParagraph(label, value));
            });

            card.appendChild(makeButton(
                "View Full Profile",
                () => loadVehicleProfile(vehicle.vehicle_id)
            ));

            card.appendChild(makeButton(
                "Edit Vehicle",
                () => editVehicle(vehicle.vehicle_id),
                "edit-button"
            ));

            card.appendChild(makeButton(
                "Delete Vehicle",
                () => deleteVehicle(vehicle.vehicle_id),
                "delete-button"
            ));

            list.appendChild(card);
        });

        await populateVehicleDropdowns();
    } catch (error) {
        if (error.message !== "Session expired") showError("vehicleList", error.message);
    }
}

async function saveVehicle() {
    const vehicleId = document.getElementById("vehicleId").value;

    const data = {
        registration_number: document.getElementById("registrationNumber").value.trim(),
        vehicle_type: document.getElementById("vehicleType").value,
        brand: document.getElementById("brand").value.trim(),
        model: document.getElementById("model").value.trim(),
        manufacturing_year: document.getElementById("manufacturingYear").value || null,
        puc_number: document.getElementById("vehiclePucNumber").value.trim(),
        puc_issue_date: document.getElementById("vehiclePucIssueDate").value || null,
        puc_expiry_date: document.getElementById("vehiclePucExpiryDate").value || null
    };

    if (!data.registration_number) {
        alert("Please enter the registration number.");
        return;
    }

    const pucFields = [
        data.puc_number,
        data.puc_issue_date,
        data.puc_expiry_date
    ];
    const filledPucFields = pucFields.filter(Boolean).length;

    if (!vehicleId && filledPucFields > 0 && filledPucFields < 3) {
        alert("To add PUC details here, fill in the PUC number, issue date and expiry date. Otherwise, leave all three blank and add them later from the PUC page.");
        return;
    }

    if (data.puc_issue_date && data.puc_expiry_date &&
        data.puc_expiry_date < data.puc_issue_date) {
        alert("PUC expiry date cannot be before its issue date.");
        return;
    }

    try {
        const url = vehicleId
            ? `${API_URL}/api/vehicles/${encodeURIComponent(vehicleId)}`
            : `${API_URL}/api/vehicles`;

        // PUC fields are sent when adding a vehicle. When editing, update
        // vehicle details only; use the PUC page to edit its certificate.
        const response = await apiFetch(url, {
            method: vehicleId ? "PUT" : "POST",
            body: JSON.stringify(data)
        });

        const result = await readResponse(response);
        alert(result.message || "Vehicle saved successfully.");

        clearVehicleForm();
        await loadVehicles();
        await loadDashboard();
        await loadPUC();
    } catch (error) {
        if (error.message !== "Session expired") alert(error.message);
    }
}

async function editVehicle(id) {
    try {
        const vehicles = await readResponse(
            await apiFetch(`${API_URL}/api/vehicles`)
        );
        const vehicle = vehicles.find(
            item => Number(item.vehicle_id) === Number(id)
        );

        if (!vehicle) {
            alert("Vehicle not found.");
            return;
        }

        document.getElementById("vehicleId").value = vehicle.vehicle_id;
        document.getElementById("registrationNumber").value = vehicle.registration_number || "";
        document.getElementById("vehicleType").value = vehicle.vehicle_type || "Car";
        document.getElementById("brand").value = vehicle.brand || "";
        document.getElementById("model").value = vehicle.model || "";
        document.getElementById("manufacturingYear").value = vehicle.manufacturing_year || "";

        // PUC editing is handled on the PUC page.
        document.getElementById("vehiclePucNumber").value = "";
        document.getElementById("vehiclePucIssueDate").value = "";
        document.getElementById("vehiclePucExpiryDate").value = "";

        document.getElementById("vehicleFormTitle").textContent = "Edit Vehicle";
        showSection("vehicles");
        window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
        if (error.message !== "Session expired") alert(error.message);
    }
}

function clearVehicleForm() {
    [
        "vehicleId", "registrationNumber", "brand", "model",
        "manufacturingYear", "vehiclePucNumber",
        "vehiclePucIssueDate", "vehiclePucExpiryDate"
    ].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = "";
    });

    document.getElementById("vehicleType").value = "Car";
    document.getElementById("vehicleFormTitle").textContent = "Add Vehicle";
}

async function deleteVehicle(id) {
    if (!confirm("Delete this vehicle? Related vehicle records may also be deleted. This action cannot be undone.")) {
        return;
    }

    try {
        const result = await readResponse(
            await apiFetch(`${API_URL}/api/vehicles/${encodeURIComponent(id)}`, {
                method: "DELETE"
            })
        );
        alert(result.message || "Vehicle deleted.");
        await loadVehicles();
        await loadDashboard();
        await loadPUC();
    } catch (error) {
        if (error.message !== "Session expired") alert(error.message);
    }
}

// VEHICLE PROFILE

async function loadVehicleProfile(id) {
    const content = document.getElementById("profileContent");
    const title = document.getElementById("profileTitle");

    showSection("vehicleProfile");
    content.textContent = "Loading vehicle profile...";

    try {
        const profile = await readResponse(
            await apiFetch(`${API_URL}/api/vehicles/${encodeURIComponent(id)}/profile`)
        );

        const vehicle = profile.vehicle || profile;
        title.textContent = `Vehicle Profile — ${vehicle.registration_number || ""}`;
        content.replaceChildren();

        const vehicleBox = document.createElement("div");
        vehicleBox.className = "profile-card";
        vehicleBox.innerHTML = "<h3>Vehicle Details</h3>";
        [
            ["Registration", vehicle.registration_number],
            ["Type", vehicle.vehicle_type],
            ["Brand", vehicle.brand],
            ["Model", vehicle.model],
            ["Manufacturing Year", vehicle.manufacturing_year],
            ["Owner", vehicle.owner_name],
            ["Owner Email", vehicle.owner_email],
            ["Owner Phone", vehicle.owner_phone]
        ].forEach(([label, value]) => vehicleBox.appendChild(makeParagraph(label, value)));
        content.appendChild(vehicleBox);

        const license = profile.license;
        const licenseBox = document.createElement("div");
        licenseBox.className = "profile-card";
        licenseBox.innerHTML = "<h3>Owner's Driving License</h3>";
        if (license) {
            [
                ["License Number", license.license_number],
                ["Issue Date", formatDate(license.issue_date)],
                ["Expiry Date", formatDate(license.expiry_date)],
                ["Status", license.status]
            ].forEach(([label, value]) => licenseBox.appendChild(makeParagraph(label, value)));
        } else {
            licenseBox.appendChild(makeParagraph("License", "No license record added"));
        }
        content.appendChild(licenseBox);

        const puc = profile.puc;
        const pucBox = document.createElement("div");
        pucBox.className = "profile-card";
        pucBox.innerHTML = "<h3>PUC Certificate</h3>";
        if (puc && (puc.puc_number || puc.expiry_date || puc.issue_date)) {
            [
                ["PUC Number", puc.puc_number],
                ["Issue Date", formatDate(puc.issue_date)],
                ["Expiry Date", formatDate(puc.expiry_date)],
                ["Status", puc.status]
            ].forEach(([label, value]) => pucBox.appendChild(makeParagraph(label, value)));
        } else {
            pucBox.appendChild(makeParagraph("PUC", "Details not added"));
        }
        content.appendChild(pucBox);

        const kmBox = document.createElement("div");
        kmBox.className = "profile-card";
        kmBox.innerHTML = "<h3>Kilometres Driven</h3>";
        kmBox.appendChild(makeParagraph(
            "Distance between recorded odometer readings",
            profile.km_driven === null || profile.km_driven === undefined
                ? "Not available — add service odometer readings"
                : `${Number(profile.km_driven).toLocaleString("en-IN")} km`
        ));
        content.appendChild(kmBox);

        const serviceBox = document.createElement("div");
        serviceBox.className = "profile-card";
        serviceBox.innerHTML = "<h3>Service History</h3>";

        const services = Array.isArray(profile.services) ? profile.services : [];
        if (!services.length) {
            serviceBox.appendChild(makeParagraph("Service history", "No service records"));
        } else {
            const tableContainer = document.createElement("div");
            tableContainer.className = "table-wrap";
            serviceBox.appendChild(tableContainer);

            const table = document.createElement("table");
            table.className = "data-table";
            const headers = ["Date", "Type", "Cost", "Odometer (km)", "Description"];
            const thead = document.createElement("thead");
            const headRow = document.createElement("tr");
            headers.forEach(label => {
                const th = document.createElement("th");
                th.textContent = label;
                headRow.appendChild(th);
            });
            thead.appendChild(headRow);
            table.appendChild(thead);

            const tbody = document.createElement("tbody");
            services.forEach(service => {
                const row = document.createElement("tr");
                [
                    formatDate(service.service_date),
                    service.service_type || "—",
                    money(service.cost),
                    service.odometer_reading ?? "—",
                    service.description || "—"
                ].forEach(value => {
                    const td = document.createElement("td");
                    td.textContent = String(value);
                    row.appendChild(td);
                });
                tbody.appendChild(row);
            });
            table.appendChild(tbody);
            tableContainer.appendChild(table);
        }
        content.appendChild(serviceBox);
    } catch (error) {
        if (error.message !== "Session expired") {
            content.textContent = `Could not load vehicle profile: ${error.message}`;
        }
    }
}

// DRIVING LICENSE — account holder, not vehicle

async function loadLicenses() {
    try {
        const rows = await readResponse(
            await apiFetch(`${API_URL}/api/licenses`)
        );

        renderTable("licenseList", rows, [
            { label: "License Number", key: "license_number" },
            { label: "Issue Date", render: row => formatDate(row.issue_date) },
            { label: "Expiry Date", render: row => formatDate(row.expiry_date) },
            { label: "Status", key: "status" }
        ], "No driving license record found.");
    } catch (error) {
        if (error.message !== "Session expired") showError("licenseList", error.message);
    }
}

async function addLicense() {
    const data = {
        license_number: document.getElementById("licenseNumber").value.trim(),
        issue_date: document.getElementById("licenseIssueDate").value,
        expiry_date: document.getElementById("licenseExpiryDate").value
    };

    if (!data.license_number || !data.issue_date || !data.expiry_date) {
        alert("Please fill in all license fields.");
        return;
    }
    if (data.expiry_date < data.issue_date) {
        alert("License expiry date cannot be before the issue date.");
        return;
    }

    try {
        const result = await readResponse(
            await apiFetch(`${API_URL}/api/licenses`, {
                method: "POST",
                body: JSON.stringify(data)
            })
        );

        alert(result.message || "License saved successfully.");
        await loadLicenses();
        await loadDashboard();
    } catch (error) {
        if (error.message !== "Session expired") alert(error.message);
    }
}

// PUC — every vehicle is listed, whether or not details exist

async function loadPUC() {
    const list = document.getElementById("pucList");
    if (!list) return;

    try {
        const rows = await readResponse(
            await apiFetch(`${API_URL}/api/puc`)
        );

        list.replaceChildren();

        if (!Array.isArray(rows) || rows.length === 0) {
            list.textContent = "No vehicles found. Add a vehicle first.";
            return;
        }

        rows.forEach(row => {
            const card = document.createElement("div");
            card.className = "vehicle-card";

            const title = document.createElement("h3");
            title.textContent = row.registration_number || "Vehicle";
            card.appendChild(title);

            [
                ["PUC Number", row.puc_number],
                ["Issue Date", formatDate(row.issue_date)],
                ["Expiry Date", formatDate(row.expiry_date)],
                ["Status", row.status || "Not Added"]
            ].forEach(([label, value]) => card.appendChild(makeParagraph(label, value)));

            const form = document.createElement("div");
            form.className = "puc-edit-form hidden";

            const number = document.createElement("input");
            number.type = "text";
            number.placeholder = "PUC certificate number";
            number.value = row.puc_number || "";

            const issue = document.createElement("input");
            issue.type = "date";
            issue.value = row.issue_date ? String(row.issue_date).slice(0, 10) : "";

            const expiry = document.createElement("input");
            expiry.type = "date";
            expiry.value = row.expiry_date ? String(row.expiry_date).slice(0, 10) : "";

            [number, issue, expiry].forEach((input, index) => {
                const labelElement = document.createElement("label");
                labelElement.textContent = [
                    "PUC Number", "Issue Date", "Expiry Date"
                ][index];
                form.append(labelElement, input);
            });

            form.appendChild(makeButton("Save PUC", async () => {
                const data = {
                    vehicle_id: row.vehicle_id,
                    puc_number: number.value.trim(),
                    issue_date: issue.value,
                    expiry_date: expiry.value
                };

                if (!data.puc_number || !data.issue_date || !data.expiry_date) {
                    alert("Enter the PUC number, issue date and expiry date.");
                    return;
                }
                if (data.expiry_date < data.issue_date) {
                    alert("PUC expiry date cannot be before the issue date.");
                    return;
                }

                try {
                    const result = await readResponse(
                        await apiFetch(`${API_URL}/api/puc`, {
                            method: "POST",
                            body: JSON.stringify(data)
                        })
                    );
                    alert(result.message || "PUC saved successfully.");
                    await loadPUC();
                    await loadDashboard();
                } catch (error) {
                    if (error.message !== "Session expired") alert(error.message);
                }
            }));

            card.appendChild(makeButton(
                row.puc_number ? "Edit / Renew PUC" : "Add PUC Details",
                () => form.classList.toggle("hidden"),
                "edit-button"
            ));
            card.appendChild(form);
            list.appendChild(card);
        });
    } catch (error) {
        if (error.message !== "Session expired") showError("pucList", error.message);
    }
}

// SERVICE

async function addService() {
    const data = {
        vehicle_id: document.getElementById("serviceVehicleId").value,
        service_date: document.getElementById("serviceDate").value,
        service_type: document.getElementById("serviceType").value.trim(),
        cost: document.getElementById("serviceCost").value || null,
        odometer_reading: document.getElementById("odometerReading").value || null,
        description: document.getElementById("serviceDescription").value.trim()
    };

    if (!data.vehicle_id || !data.service_date) {
        alert("Please select a vehicle and enter the service date.");
        return;
    }
    if (data.odometer_reading !== null && Number(data.odometer_reading) < 0) {
        alert("Odometer reading cannot be negative.");
        return;
    }

    try {
        const result = await readResponse(
            await apiFetch(`${API_URL}/api/services`, {
                method: "POST",
                body: JSON.stringify(data)
            })
        );
        alert(result.message || "Service record added.");

        ["serviceDate", "serviceType", "serviceCost",
            "odometerReading", "serviceDescription"].forEach(id => {
            document.getElementById(id).value = "";
        });

        await loadServices();
        await loadDashboard();
    } catch (error) {
        if (error.message !== "Session expired") alert(error.message);
    }
}

async function loadServices() {
    try {
        const rows = await readResponse(
            await apiFetch(`${API_URL}/api/services`)
        );

        renderTable("serviceList", rows, [
            { label: "Registration", key: "registration_number" },
            { label: "Date", render: row => formatDate(row.service_date) },
            { label: "Type", key: "service_type" },
            { label: "Cost", render: row => money(row.cost) },
            { label: "Odometer (km)", key: "odometer_reading" },
            { label: "Description", key: "description" }
        ], "No service records found.");

        await populateVehicleDropdowns();
    } catch (error) {
        if (error.message !== "Session expired") showError("serviceList", error.message);
    }
}

// ALERTS — these are informational; no unsupported completion button.

async function loadAlerts(silent = false) {
    try {
        const rows = await readResponse(
            await apiFetch(`${API_URL}/api/alerts`)
        );

        const targets = silent
            ? ["dashboardAlerts"]
            : ["alertList", "dashboardAlerts"];

        targets.forEach(targetId => {
            const list = document.getElementById(targetId);
            if (!list) return;
            list.replaceChildren();

            if (!Array.isArray(rows) || rows.length === 0) {
                list.textContent = "No current expiry alerts.";
                return;
            }

            rows.forEach(item => {
                const card = document.createElement("div");
                card.className = "alert-card";

                const heading = document.createElement("h3");
                const type = String(item.alert_type || "Expiry Alert");
                const registration = item.registration_number
                    ? ` — ${item.registration_number}`
                    : "";
                heading.textContent = `${type}${registration}`;

                const message = document.createElement("p");
                message.textContent = item.message || "A document needs attention.";

                const date = document.createElement("p");
                date.textContent = `Expiry / alert date: ${formatDate(
                    item.expiry_date || item.alert_date
                )}`;

                card.append(heading, message, date);
                list.appendChild(card);
            });
        });

        const notice = document.getElementById("expiryNotice");
        if (notice) {
            notice.classList.toggle("hidden", !rows.length);
            notice.textContent = rows.length
                ? `Reminder: ${rows.length} license or PUC expiry alert(s) need your attention. Open Alerts to review them.`
                : "";
        }
    } catch (error) {
        if (error.message !== "Session expired") {
            console.error("Alert loading error:", error);
            if (!silent) showError("alertList", error.message);
        }
    }
}

// STARTUP

window.addEventListener("load", async () => {
    const token = getToken();
    const authSection = document.getElementById("authSection");
    const appContent = document.getElementById("appContent");

    if (!token) {
        authSection.classList.remove("hidden");
        appContent.classList.add("hidden");

        const message = sessionStorage.getItem("logoutMessage");
        if (message) {
            showAuthMessage(message, true);
            sessionStorage.removeItem("logoutMessage");
        }
        return;
    }

    authSection.classList.add("hidden");
    appContent.classList.remove("hidden");
    addAccountBar();

    try {
        const user = await readResponse(
            await apiFetch(`${API_URL}/api/me`)
        );
        localStorage.setItem(USER_KEY, JSON.stringify(user));

        const bar = document.getElementById("accountBar");
        if (bar) bar.remove();
        addAccountBar();

        await populateVehicleDropdowns();
        await loadDashboard();
        await loadVehicles();
    } catch (error) {
        if (error.message !== "Session expired") {
            console.error("Startup error:", error);
        }
    }
});

// Remove an older service worker if one was previously installed.

if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        try {
            const registration = await navigator.serviceWorker.register(
                "/service-worker.js"
            );
            console.log(
                "Vehicle Tracker service worker registered:",
                registration.scope
            );
        } catch (error) {
            console.error(
                "Vehicle Tracker service worker registration failed:",
                error
            );
        }
    });
}


if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        try {
            await navigator.serviceWorker.register("/service-worker.js");
            console.log("Vehicle Tracker service worker registered.");
        } catch (error) {
            console.error("Service worker registration failed:", error);
        }
    });
}
