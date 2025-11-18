import * as d3 from 'd3';
import { sliderHorizontal } from 'd3-simple-slider';
import winkSentiment from 'wink-sentiment';

let allData = [];
let currentSource = "./weeklymovies.csv";
let currentMediaType = "movies";
let showDescriptions = {};

// loading geojson
let geojson = await d3.json('./countries.geojson')

// Variable to store current map instance
let currentMap = null;

// Variable to store movie/show country data
let mediaTitles = [];

// Fetch country data for all titles on page load
async function loadCountryData() {
    const csvData = await d3.csv(currentSource, function(d) {
        d.weekly_hours_viewed = +d.weekly_hours_viewed;
        d.weekly_views = +d.weekly_views;
        return d;
    });
    
    // Get unique titles
    const uniqueTitles = [...new Set(csvData.map(d => d.show_title))];
    
    // Fetch country data for first 50 titles (to not hit rate limits too hard)
    for (let i = 0; i < Math.min(50, uniqueTitles.length); i++) {
        const titleName = uniqueTitles[i];
        const titleRow = csvData.find(d => d.show_title === titleName);
        
        if (titleRow && titleRow.tconst) {
            const countryInfo = await fetchProductionCountries(titleRow.tconst);
            
            if (countryInfo?.productionCountries.length > 0) {
                mediaTitles.push({
                    title: titleName,
                    countries: countryInfo.productionCountries.map(c => c.name)
                });
            }
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`Loaded country data for ${mediaTitles.length} titles`);
    return csvData;
}

// get country coordinates
function getCountryCoordinates(countryName) {
    // fallback coordinates first because they are better
    const fallback = {
        'United States of America': { lat: 39.8283, lng: -98.5795 },
        'United Kingdom': { lat: 55.3781, lng: -3.4360 },
        'Canada': { lat: 56.1304, lng: -106.3468 },
        'France': { lat: 46.2276, lng: 2.2137 },
        'Germany': { lat: 51.1657, lng: 10.4515 },
        'Japan': { lat: 36.2048, lng: 138.2529 },
        'South Korea': { lat: 35.9078, lng: 127.7669 },
        'India': { lat: 20.5937, lng: 78.9629 },
        'Australia': { lat: -25.2744, lng: 133.7751 },
        'Spain': { lat: 40.4637, lng: -3.7492 },
        'Italy': { lat: 41.8719, lng: 12.5674 },
        'Mexico': { lat: 23.6345, lng: -102.5528 },
        'Brazil': { lat: -14.2350, lng: -51.9253 }
    };
    
    if (fallback[countryName]) {
        return fallback[countryName];
    }
    
    // loc in geojson
    const feature = geojson.features.find(f => 
        f.properties.ADMIN === countryName || 
        f.properties.NAME === countryName ||
        f.properties.NAME_LONG === countryName
    );
    
    if (feature) {
        if (feature.geometry.type === 'Polygon') {
            const coords = feature.geometry.coordinates[0];
            const midPoint = coords[Math.floor(coords.length / 2)];
            return { lat: midPoint[1], lng: midPoint[0] };
        } else if (feature.geometry.type === 'MultiPolygon') {
            const coords = feature.geometry.coordinates[0][0];
            const midPoint = coords[Math.floor(coords.length / 2)];
            return { lat: midPoint[1], lng: midPoint[0] };
        }
    }
    
    return { lat: 0, lng: 0 };
}

function initMiniMap(titleName) {
    // Clean up previous map
    if (currentMap) {
        currentMap.remove();
        currentMap = null;
    }
    
    const mapContainer = document.getElementById('mini-map');
    if (!mapContainer) return;
    
    const titleData = mediaTitles.find(item => item.title === titleName);
    
    if (!titleData || !titleData.countries || titleData.countries.length === 0) {
        mapContainer.innerHTML = '<div style="padding: 10px; text-align: left; color: #35353bff; font-size: 12px;">map loading...</div>';
        return;
    }
    
    const country = titleData.countries[0];
    const coords = getCountryCoordinates(country);
    
    if (!coords.lat && !coords.lng) {
        mapContainer.innerHTML = `<div style="padding: 10px; text-align: center; color: white;">${country}</div>`;
        return;
    }
    
    // create map
    currentMap = L.map('mini-map', {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false
    }).setView([coords.lat, coords.lng], 1);
    
    // add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(currentMap);
    
    // add marker
    L.marker([coords.lat, coords.lng]).addTo(currentMap)
        .bindPopup(country)
        .openPopup();

    // adjust title text
    L.marker([coords.lat, coords.lng]).addTo(currentMap)
    .bindPopup(country, {
        className: 'custom-popup'
    })
    .openPopup();
}

// tmdb token
const TMDB_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJjYTQ2ODZmOTM5ZmI5MjM3ODNjNGRiYTlmNTFmNDU0YyIsIm5iZiI6MTc1OTg0NDk3Mi40MDksInN1YiI6IjY4ZTUxYTZjN2VkOWM2ZjUzZTI1YmY2ZSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.XQFm3CJiePIMsdWbH0OFb1bERpTQNgiv6WHg1RxmcOg"

// Fetch production countries from TMDB using title
// Note: production_countries represents where content was produced/filmed
async function fetchProductionCountriesByTitle(title, mediaType = 'movie') {
    const searchUrl = `https://api.themoviedb.org/3/search/${mediaType}?query=${encodeURIComponent(title)}&include_adult=false&language=en-US&page=1`;
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${TMDB_TOKEN}`
        }
    };
    
    try {
        const searchResponse = await fetch(searchUrl, options);
        const searchData = await searchResponse.json();
        
        if (!searchData.results || searchData.results.length === 0) return null;
        
        const tmdbId = searchData.results[0].id;
        
        const detailsUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}`;
        const detailsResponse = await fetch(detailsUrl, options);
        const details = await detailsResponse.json();
        
        return {
            productionCountries: details.production_countries || []
        };
    } catch (error) {
        console.error(`Error fetching ${title}:`, error);
        return null;
    }
}

// Fetch country data for titles
async function fetchTitlesWithCountries(data, maxCount, type) {
    const enrichedData = []
    
    for (let i = 0; i < maxCount; i++) {
        const title = data[i]
        const imdbId = title.tconst || title['externals.imdb']
        
        document.getElementById('loader-text').textContent = `Loading ${type}: ${i + 1} / ${maxCount}`
        
        if (!imdbId) continue
        
        const countryInfo = await fetchProductionCountries(imdbId)
        
        if (countryInfo?.productionCountries.length > 0) {
            enrichedData.push({
                title: title.Title || title.name,
                countries: countryInfo.productionCountries.map(c => c.name)
            })
        }
        
        await new Promise(resolve => setTimeout(resolve, 25))
    }
    
    return enrichedData
}

// interactive code below

// Load data with country info
// Load CSV data immediately for the chart
d3.csv(currentSource, function(d) {
    d.weekly_hours_viewed = +d.weekly_hours_viewed;
    d.weekly_views = +d.weekly_views;
    return d;
}).then(function(data) {
    allData = data;
    const weeks = Array.from(new Set(data.map(d => d.week))).sort();
    const initialWeek = weeks[0];
    const initialData = data.filter(d => d.week === initialWeek);
    createChart(initialData);
    createSlider(data);
    
    // Fetch country data in the background (don't wait for it)
    fetchCountryDataInBackground(data);
});

// Fetch country data without blocking the UI
async function fetchCountryDataInBackground(csvData) {
    const uniqueTitles = [...new Set(csvData.map(d => d.show_title))];
    console.log(`Starting to fetch country data for ${uniqueTitles.length} unique titles`);
    
    for (let i = 0; i < Math.min(50, uniqueTitles.length); i++) {
        const titleName = uniqueTitles[i];
        
        console.log(`[${i}] Processing: ${titleName}`);
        
        // Search by title instead of IMDB ID
        const countryInfo = await fetchProductionCountriesByTitle(titleName, currentMediaType === 'movies' ? 'movie' : 'tv');
        console.log(`    Country info:`, countryInfo);
        
        if (countryInfo?.productionCountries.length > 0) {
            mediaTitles.push({
                title: titleName,
                countries: countryInfo.productionCountries.map(c => c.name)
            });
            console.log(`    ✓ Added countries:`, countryInfo.productionCountries.map(c => c.name));
        } else {
            console.log(`    ✗ No countries found`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 250)); // Increased delay for search API
    }
    
    console.log(`Finished! Loaded country data for ${mediaTitles.length} titles`);
    console.log('mediaTitles array:', mediaTitles);
}

let currentData = "weekly_hours_viewed";

const formatComma = d3.format(",");
const formatDate = d3.timeFormat("%B %e, %Y");
const parseDate = d3.timeParse("%Y-%m-%d");


function wrap(textSelection, width, titleText) {
    var words = titleText.split(/\s+/).reverse(),
        word,
        line = [],
        lineNumber = 0,
        lineHeight = 1.1,
        y = textSelection.attr("y") || 0,
        tspan = textSelection.text(null)
            .append("tspan")
            .attr("x", 0)
            .attr("y", y)
            .attr("dy", "0em")
            .style("font-size", textSelection.style("font-size"));

    while (word = words.pop()) {
        line.push(word);
        tspan.text(line.join(" "));
        if (tspan.node().getComputedTextLength() > width+20 && line.length > 1) {
            line.pop();
            tspan.text(line.join(" "));
            line = [word];
            tspan = textSelection.append("tspan")
                .attr("x", 0)
                .attr("dy", lineHeight + "em")
                .text(word)
            lineNumber++;
        }
    }

    const tspans = textSelection.selectAll("tspan").nodes();
    const totalHeight = tspans.length * lineHeight;
    const offset = -((tspans.length - 1) / 2) * lineHeight;

    tspans.forEach((tspan, i) => {
        d3.select(tspan).attr("dy", (i === 0 ? offset : lineHeight) + "em")
        d3.select(tspan).style("font-size", textSelection.style("font-size"));
    });
}

function createSlider(data) {
    const weeks = Array.from(new Set(data.map(d => d.week))).sort();

    var slider = sliderHorizontal()
        .min(0)
        .max(weeks.length - 1)
        .step(1)
        .width(480)
        .displayValue(false)
        .tickFormat(i => weeks[i])
        .ticks(weeks.length)
        .on('onchange', val => {
            const selectedWeek = weeks[val];
            const dateObj = parseDate(selectedWeek);
            const formattedDate = formatDate(dateObj);
            d3.select('#dates').text(`Week of ${formattedDate}`);
            updateChart(data, selectedWeek);
        });

    d3.select('#slider')
        .append('svg')
        .attr('width', 500)
        .attr('height', 50)
        .append('g')
        .attr('transform', 'translate(5,30)')
        .attr('stroke-width', 0)
        .call(slider)
        .selectAll("text")
        .style("font-size", "0px")
        .style("font-weight", "400");
}

function createChart(data) {
    d3.select("#chart").selectAll("*").remove();

    var chartDiv = document.getElementById("chart");
    var width = chartDiv.clientWidth;
    var height = chartDiv.clientHeight;

    var svg = d3.select("#chart")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    const domains = {
        weekly_hours_viewed: d3.extent(data, d => d.weekly_hours_viewed),
        weekly_views: d3.extent(data, d => d.weekly_views)
    }
    
    var size = d3.scaleLinear()
        .domain(domains[currentData])
        .range([70,180]); 

    var textSize = d3.scaleLinear()
        .domain(domains[currentData])
        .range([12,40]);

    var color = d3.scaleLinear()
        .domain(domains[currentData])
        .range(['#ff9191ff', '#fb181c']);

    var tooltip = d3.select("#chart")
        .append("div")
        .style("opacity", 0)
        .attr("class", "tooltip")
        .style("position", "absolute")
        .style("background-color", "black")
        .style("border", "solid")
        .style("border-width", "1px")
        .style("border-radius", "5px")
        .style("border-color", "white")
        .style("padding-right", "15px")
        .style("padding-left", "15px")
        .style("font-size", "8px")
        .style("font-weight", 800);

    
    function getExtraText(d) {
    const data = showDescriptions[d.show_title];
    const sentimentScore = data.sentiment;

    if (sentimentScore > 0) {
        return "<br><span style=\"color: #49a47fff;\">good things happen in this show.</span>";
    } else if (sentimentScore < 0) {
        return "<br><span style=\"color: #c03131ff;\">bad things happen in this show.</span>";
    } else {
        return "<br><span style=\"color: #7a7a87ff;\">it's unclear if what happens in this show can be characterized as good or bad.</span>";
    }
    }

    var mouseover = function(event, d) {
        tooltip.style("opacity", 1);
        
        // create the tooltip HTML with map container
        tooltip
            .html('<p>' + d.show_title + '<br><span>' + formatComma(d[currentData]) + 
                (currentData === "weekly_views" ? " views" : " hours viewed") + '</span>' + 
                (currentMediaType === "shows" && showDescriptions[d.show_title] ? getExtraText(d) : '') + ('<br><br><span style=\"color: #7a7a87ff;\">produced in:</span>') +
                '<div id="mini-map" style="width: 220px; height: 160px; margin-top: 10px; border: 1px solid #35353bff; border-radius: 3px;"></div></p>');
        
        // initialize map only once on mouseover
        setTimeout(() => {
            initMiniMap(d.show_title);
        }, 10);
    }
    
    var mousemove = function(event, d) {
        tooltip
            .style("left", (event.pageX + 20) + "px")
            .style("top", (event.pageY) + "px");
    }

    var mouseleave = function(event, d) {
        tooltip.style("opacity", 0);
        if (currentMap) {
            currentMap.remove();
            currentMap = null;
        }
    }
    
    var simulation = d3.forceSimulation()
        .force("center", d3.forceCenter().x((width / 2) + 400).y(height / 2))
        .force("charge", d3.forceManyBody().strength(.1))
        .force("collide", d3.forceCollide().strength(.2).radius(function(d){ return (size(d[currentData])+3) }).iterations(1))
            
    simulation.alpha(1).restart();

    function dragstarted(event, d) {
        simulation.alphaTarget(0.2).restart();
        d.fx = d.x;
        d.fy = d.y;
    }
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    function dragended(event, d) {
        simulation.alphaTarget(0.0);
        d.fx = null;
        d.fy = null;
    }

    var node = svg.append("g")
        .selectAll("circle")
        .data(data)
        .enter()
        .append("circle")
        .attr("class", "node")
        .attr("r", function(d){ return size(d[currentData]); })
        .attr("cx", width / 2)
        .attr("cy", height / 2)
        .style("fill", function(d){ return color(d.weekly_hours_viewed); })
        .style("fill-opacity", 1)
        .on("mouseover", mouseover)
        .style("cursor", "grab")
        .on("mousemove", mousemove)
        .on("mouseleave", mouseleave)
        .call(d3.drag()
           .on("start", dragstarted)
           .on("drag", dragged)
           .on("end", dragended));

    var title = svg.append("g")
        .selectAll("text")
        .data(data)
        .enter()
        .append("text")
        .attr("class", "title")
        .attr("fill", "#FFFFFF")
        .style("text-anchor", "middle")
        .style("text-transform", "lowercase")
        .style("font-weight", 800)
        .style("font-size", function(d){ return textSize(d[currentData]) + "px";})
        .on("mouseover", mouseover)
        .style("cursor", "grab")
        .on("mousemove", mousemove)
        .on("mouseleave", mouseleave)
        .each(function(d) {
            const maxWidth = size(d[currentData]) - 10;
            wrap(d3.select(this), maxWidth, d.show_title);
        });
    
    simulation
        .nodes(data)
        .on("tick", function(){
            node
                .attr("cx", function(d){ return d.x; })
                .attr("cy", function(d){ return d.y; });
            title
                .attr("x", function(d){ return d.x; })
                .attr("y", function(d){ return d.y; })
                .attr("transform", function(d){ 
                    return "translate(" + d.x + "," + (d.y) + ")";
                });
        });
}   

function updateChart(data, selectedWeek) {
    const filteredData = data.filter(d => d.week === selectedWeek);
    d3.select("#chart").selectAll("*").remove();
    createChart(filteredData);
}

document.getElementById("toggle").addEventListener("click", function () {
    currentData = currentData === "weekly_hours_viewed" ? "weekly_views" : "weekly_hours_viewed";
    this.textContent = currentData === "weekly_views" ? "views" : "hours viewed";

    const currentWeek = d3.select("#dates").text().replace("Week of ", "");
    const parsedWeek = d3.timeParse("%B %e, %Y")(currentWeek);
    const formattedWeek = d3.timeFormat("%Y-%m-%d")(parsedWeek);

    updateChart(allData, formattedWeek);
});

document.getElementById("mediatype").addEventListener("click", function () {
    if (currentMediaType === "movies") {
        currentMediaType = "shows";
        currentSource = "./TV_Top10.csv";
        this.textContent = "shows";

        Promise.all([
            d3.csv(currentSource, d => {
                d.weekly_hours_viewed = +d.weekly_hours_viewed;
                d.weekly_views = +d.weekly_views;
                return d;
            }),
            d3.csv("./description.csv")
        ]).then(([showData, descriptionData]) => {
            allData = showData;

            showDescriptions = {};
            descriptionData.forEach(d => {
                let sentimentScore = winkSentiment(d.summary).score;
                showDescriptions[d.show_title] = {
                    summary: d.summary,
                    sentiment: sentimentScore
                };
            });

            updateChartAndSlider(showData);
        });

    } else {
        currentMediaType = "movies";
        currentSource = "./weeklymovies.csv";
        this.textContent = "movies";

        d3.csv(currentSource, d => {
            d.weekly_hours_viewed = +d.weekly_hours_viewed;
            d.weekly_views = +d.weekly_views;
            return d;
        }).then(data => {
            allData = data;
            showDescriptions = {};
            updateChartAndSlider(data);
        });
    }
});

// updating chart and slider
function updateChartAndSlider(data) {
    const currentWeekText = d3.select("#dates").text().replace("Week of ", "");
    const parsedWeek = d3.timeParse("%B %e, %Y")(currentWeekText);
    const formattedWeek = d3.timeFormat("%Y-%m-%d")(parsedWeek);

    d3.select('#slider').selectAll("*").remove();
    createSlider(data);
    updateChart(data, formattedWeek);
    
    // Clear and refetch country data
    mediaTitles = [];
    fetchCountryDataInBackground(data);
}