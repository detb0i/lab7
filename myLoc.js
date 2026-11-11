'use strict';

const ourCoords = { latitude: 48.94321, longitude: 24.73380 };

const PLACES = {
    college: { name: 'Коледжу', coords: ourCoords },
    rada: { name: 'Верховної Ради', coords: { latitude: 50.44732, longitude: 30.53242 } }
};

const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

const MAX_HISTORY = 100;
const STORAGE_HISTORY = 'geo:history';
const STORAGE_DEST = 'geo:destination';

let watchId = null; 
let updatesCount = 0;  
let lastPosition = null; 
let history = [];            
let destination = null;  
let map = null;
let latestMarker = null;
let accuracyCircle = null;
let trackLine = null;
let destMarker = null;
let dotsLayer = null;
let mapCentered = false;

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

function init() {
    initMap();
    restoreState();
    bindControls();
    getMyLocation();
}

function bindControls() {
    $('watch').onclick = watchLocation;
    $('clearWatch').onclick = clearWatch;
    $('locate').onclick = getMyLocation;
    $('place').onchange = updateDistances;
    $('destForm').addEventListener('submit', onDestSubmit);
    $('goDest').onclick = goToDestination;
    $('clearHistory').onclick = clearHistory;
    updateWatchUI();
}


function getMyLocation() {
    if (!navigator.geolocation) {
        alert('Oops, no geolocation support');
        showLocationText('Геолокація не підтримується цим браузером.');
        return;
    }
    if (!window.isSecureContext && location.protocol !== 'file:') {
        showError('Геолокація працює лише на HTTPS (або localhost). Відкрийте сторінку через захищене з’єднання.');
    }
    navigator.geolocation.getCurrentPosition(displayLocation, displayError, GEO_OPTIONS);
}
function displayLocation(position) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const accuracy = position.coords.accuracy;

    updatesCount++;
    hideError();

    showLocationText(`Ви тут: широта ${latitude.toFixed(7)}, довгота ${longitude.toFixed(7)}`);
    $('accuracy').textContent = `(точність визначення: ${accuracy.toFixed(1)} м)`;

    lastPosition = {
        lat: latitude,
        lng: longitude,
        acc: accuracy,
        time: position.timestamp || Date.now()
    };

    updateDistances();
    updateWatchUI();
    addPositionToMap(lastPosition);
}

function displayError(error) {
    const errorTypes = {
        0: 'Невідома помилка',
        1: 'Користувач заборонив доступ до геолокації',
        2: 'Позицію визначити неможливо',
        3: 'Час очікування відповіді вичерпано'
    };
    let errorMessage = errorTypes[error.code] || errorTypes[0];
    if (error.code === 0 || error.code === 2) {
        errorMessage = errorMessage + ' ' + error.message;
    }

    showError(errorMessage);
    if (!lastPosition) {
        showLocationText('');
    }
    if (error.code === 1) {
        clearWatch();
    }
}

function showLocationText(text) { $('location').textContent = text; }

function showError(text) {
    const el = $('error');
    el.textContent = text;
    el.hidden = false;
}
function hideError() { $('error').hidden = true; }

function degreesToRadians(degrees) {
    return (degrees * Math.PI) / 180;
}

function computeDistance(startCoords, destCoords) {
    const startLatRads = degreesToRadians(startCoords.latitude);
    const startLongRads = degreesToRadians(startCoords.longitude);
    const destLatRads = degreesToRadians(destCoords.latitude);
    const destLongRads = degreesToRadians(destCoords.longitude);
    const Radius = 6371;

    const dLat = destLatRads - startLatRads;
    const dLong = destLongRads - startLongRads;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(startLatRads) * Math.cos(destLatRads) * Math.sin(dLong / 2) ** 2;

    return 2 * Radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

function formatDistance(km) {
    return km < 1 ? `${Math.round(km * 1000)} м` : `${km.toFixed(3)} км`;
}

function updateDistances() {
    const place = PLACES[$('place').value];
    if (lastPosition) {
        const km = computeDistance(
            { latitude: lastPosition.lat, longitude: lastPosition.lng },
            place.coords
        );
        $('distance').textContent = `Ви за ${formatDistance(km)} від ${place.name}`;
    } else {
        $('distance').textContent = 'Тут з’явиться відстань до обраного місця.';
    }
    updateDestInfo();
}

function watchLocation() {
    if (!navigator.geolocation || watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(displayLocation, displayError, GEO_OPTIONS);
    updateWatchUI();
}

function clearWatch() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    updateWatchUI();
}

function updateWatchUI() {
    const active = watchId !== null;
    $('watch').disabled = active;
    $('clearWatch').disabled = !active;
    const status = $('watchStatus');
    status.classList.toggle('on', active);
    status.textContent = active
        ? `Відстеження увімкнено. Оновлень отримано: ${updatesCount}.`
        : 'Відстеження вимкнено.';
}

function initMap() {
    const container = $('map');
    if (typeof L === 'undefined') {
        container.innerHTML = '<p class="map-fallback">Не вдалося завантажити бібліотеку карти Leaflet. Перевірте підключення до Інтернету.</p>';
        return;
    }

    map = L.map('map').setView([ourCoords.latitude, ourCoords.longitude], 13);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    dotsLayer = L.layerGroup().addTo(map);
    map.on('click', (e) => {
        $('destLat').value = e.latlng.lat.toFixed(6);
        $('destLng').value = e.latlng.lng.toFixed(6);
        setDestination(e.latlng.lat, e.latlng.lng);
    });
}

function popupHtml(p, title) {
    return `<strong>${title}</strong><br>` +
        `Широта: ${p.lat.toFixed(6)}<br>` +
        `Довгота: ${p.lng.toFixed(6)}<br>` +
        `Час: ${new Date(p.time).toLocaleString('uk-UA')}<br>` +
        `Точність: ${Math.round(p.acc)} м`;
}

function addHistoryDot(p) {
    if (!map) return;
    L.circleMarker([p.lat, p.lng], {
        radius: 6, color: '#0a6a85', weight: 2, fillColor: '#ffffff', fillOpacity: 1
    }).bindPopup(popupHtml(p, 'Попередня позиція')).addTo(dotsLayer);
}

function addPositionToMap(p) {
    const prev = history[history.length - 1];
    const isNew = !prev || prev.lat !== p.lat || prev.lng !== p.lng;

    if (isNew) {
        history.push(p);
        if (history.length > MAX_HISTORY) history.shift();
        saveState();
        renderHistory();
    }

    if (!map) return;

    drawAccuracy(p);
    if (!isNew && latestMarker) return;

    if (latestMarker) {
        map.removeLayer(latestMarker);
        if (prev) addHistoryDot(prev);
    }

    const firstMarker = !latestMarker;
    latestMarker = L.marker([p.lat, p.lng]).addTo(map).bindPopup(popupHtml(p, 'Ви тут'));
    if (firstMarker) latestMarker.openPopup();

    drawTrack();

    if (!mapCentered) {
        map.setView([p.lat, p.lng], 16);
        mapCentered = true;
    } else if ($('follow').checked) {
        map.panTo([p.lat, p.lng]);
    }
}

function drawAccuracy(p) {
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    accuracyCircle = L.circle([p.lat, p.lng], {
        radius: p.acc, color: '#0a6a85', weight: 1, fillOpacity: 0.08, interactive: false
    }).addTo(map);
}

function drawTrack() {
    const points = history.map((h) => [h.lat, h.lng]);
    if (trackLine) {
        trackLine.setLatLngs(points);
    } else if (points.length > 1) {
        trackLine = L.polyline(points, { color: '#0a6a85', weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(map);
    }
}

function renderHistory() {
    const list = $('historyList');
    list.innerHTML = '';
    if (!history.length) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = 'Поки що порожньо.';
        list.appendChild(li);
        return;
    }
    history.slice(-8).reverse().forEach((p) => {
        const li = document.createElement('li');
        li.textContent = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = new Date(p.time).toLocaleTimeString('uk-UA');
        li.appendChild(time);
        list.appendChild(li);
    });
}

function clearHistory() {
    history = [];
    if (map) {
        dotsLayer.clearLayers();
        if (latestMarker) { map.removeLayer(latestMarker); latestMarker = null; }
        if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
        if (trackLine) { map.removeLayer(trackLine); trackLine = null; }
    }
    saveState();
    renderHistory();
    if (lastPosition) addPositionToMap(lastPosition);
}

function parseCoord(value, min, max) {
    const text = String(value).trim().replace(',', '.');
    if (text === '') return null;
    const n = Number(text);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function onDestSubmit(event) {
    event.preventDefault();
    const lat = parseCoord($('destLat').value, -90, 90);
    const lng = parseCoord($('destLng').value, -180, 180);
    if (lat === null || lng === null) {
        $('destInfo').textContent = 'Введіть коректні координати: широта від −90 до 90, довгота від −180 до 180.';
        return;
    }
    setDestination(lat, lng);
    goToDestination();
}

function setDestination(lat, lng) {
    destination = { lat, lng };
    saveState();

    if (map) {
        if (destMarker) map.removeLayer(destMarker);
        destMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'dest-pin',
                html: '<span></span>',
                iconSize: [26, 26],
                iconAnchor: [13, 31],
                popupAnchor: [0, -31]
            })
        }).addTo(map).bindPopup(`<strong>Пункт призначення</strong><br>Широта: ${lat.toFixed(6)}<br>Довгота: ${lng.toFixed(6)}`);
    }
    updateDestInfo();
}

function updateDestInfo() {
    const info = $('destInfo');
    if (!destination) {
        info.textContent = 'Пункт призначення ще не задано.';
        return;
    }
    let text = `Пункт призначення: ${destination.lat.toFixed(5)}, ${destination.lng.toFixed(5)}.`;
    if (lastPosition) {
        const km = computeDistance(
            { latitude: lastPosition.lat, longitude: lastPosition.lng },
            { latitude: destination.lat, longitude: destination.lng }
        );
        text += ` Від вас: ${formatDistance(km)}.`;
    } else {
        text += ' Дозвольте доступ до геолокації, щоб побачити відстань.';
    }
    info.textContent = text;
}

function goToDestination() {
    if (!destination) {
        $('destInfo').textContent = 'Спочатку введіть координати пункту призначення.';
        return;
    }
    if (!map) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
        map.setView([destination.lat, destination.lng], 15);
    } else {
        map.flyTo([destination.lat, destination.lng], 15, { duration: 1.2 });
    }
    if (destMarker) destMarker.openPopup();
    $('map').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history));
        if (destination) {
            localStorage.setItem(STORAGE_DEST, JSON.stringify(destination));
        } else {
            localStorage.removeItem(STORAGE_DEST);
        }
    } catch (e) {
        console.warn('localStorage недоступний:', e);
    }
}

function restoreState() {
    try {
        const savedHistory = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || '[]');
        if (Array.isArray(savedHistory)) {
            history = savedHistory.filter((p) =>
                p && Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(-MAX_HISTORY);
        }
        const savedDest = JSON.parse(localStorage.getItem(STORAGE_DEST) || 'null');
        if (savedDest && Number.isFinite(savedDest.lat) && Number.isFinite(savedDest.lng)) {
            $('destLat').value = savedDest.lat;
            $('destLng').value = savedDest.lng;
            setDestination(savedDest.lat, savedDest.lng);
        }
    } catch (e) {
        history = [];
    }

    if (map) {
        history.forEach((p) => addHistoryDot({ ...p, acc: p.acc || 0, time: p.time || Date.now() }));
        drawTrack();
    }
    renderHistory();
}
