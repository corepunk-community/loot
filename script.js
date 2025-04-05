// Global variables
let lootTables = {};
let currentTable = null;

// DOM elements
const tablesList = document.getElementById('tables-list');
const itemsList = document.getElementById('items-list');
const selectedTableHeading = document.getElementById('selected-table');
const tableSearchInput = document.getElementById('table-search');
const itemSearchInput = document.getElementById('item-search');
const clearTableSearchBtn = document.getElementById('clear-table-search');
const clearItemSearchBtn = document.getElementById('clear-item-search');

// Fetch loot tables data
async function fetchLootTables() {
    try {
        const response = await fetch('loot_tables.json');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        lootTables = await response.json();
        populateTablesList();
    } catch (error) {
        console.error('Error fetching loot tables:', error);
        showError('Failed to load loot tables data. Please try again later.');
    }
}

// Populate tables list
function populateTablesList(searchTerm = '') {
    tablesList.innerHTML = '';
    
    // Sort table names alphabetically
    const sortedTableNames = Object.keys(lootTables).sort();
    
    let tablesFound = 0;
    
    sortedTableNames.forEach(tableName => {
        // Filter by search term if provided
        if (searchTerm && !tableName.toLowerCase().includes(searchTerm.toLowerCase())) {
            return;
        }
        
        tablesFound++;
        
        const li = document.createElement('li');
        li.textContent = tableName;
        li.dataset.table = tableName;
        
        li.addEventListener('click', () => {
            // Remove active class from all list items
            document.querySelectorAll('#tables-list li').forEach(item => {
                item.classList.remove('active');
            });
            
            // Add active class to clicked item
            li.classList.add('active');
            
            // Display items for this table
            displayTableItems(tableName);
        });
        
        tablesList.appendChild(li);
    });
    
    if (tablesFound === 0) {
        const li = document.createElement('li');
        li.textContent = 'No matching tables found';
        li.style.cursor = 'default';
        tablesList.appendChild(li);
    }
}

// Display items for a specific table
function displayTableItems(tableName, searchTerm = '') {
    currentTable = tableName;
    selectedTableHeading.textContent = tableName;
    itemsList.innerHTML = '';
    
    const items = lootTables[tableName];
    
    if (!items || items.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No items in this loot table';
        itemsList.appendChild(li);
        return;
    }
    
    // Sort items alphabetically
    const sortedItems = [...items].sort();
    
    let itemsFound = 0;
    
    sortedItems.forEach(item => {
        // Filter by search term if provided
        if (searchTerm && !item.toLowerCase().includes(searchTerm.toLowerCase())) {
            return;
        }
        
        itemsFound++;
        
        const li = document.createElement('li');
        li.textContent = item;
        itemsList.appendChild(li);
    });
    
    if (itemsFound === 0) {
        const li = document.createElement('li');
        li.textContent = 'No matching items found';
        itemsList.appendChild(li);
    }
}

// Search functionality
function setupSearch() {
    tableSearchInput.addEventListener('input', () => {
        populateTablesList(tableSearchInput.value.trim());
    });
    
    itemSearchInput.addEventListener('input', () => {
        if (currentTable) {
            displayTableItems(currentTable, itemSearchInput.value.trim());
        }
    });
    
    clearTableSearchBtn.addEventListener('click', () => {
        tableSearchInput.value = '';
        populateTablesList();
    });
    
    clearItemSearchBtn.addEventListener('click', () => {
        itemSearchInput.value = '';
        if (currentTable) {
            displayTableItems(currentTable);
        }
    });
}

// Show error message
function showError(message) {
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    
    document.querySelector('.container').prepend(errorElement);
}

// Initialize the application
function init() {
    fetchLootTables();
    setupSearch();
}

// Start the application when the page loads
window.addEventListener('DOMContentLoaded', init); 