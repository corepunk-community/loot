// Global variables
let lootTables = {};
let currentTable = null;
let secondTable = null;
let compareMode = false;
let globalSearchActive = false;

// DOM elements
const tablesList = document.getElementById('tables-list');
const itemsList = document.getElementById('items-list');
const selectedTableHeading = document.getElementById('selected-table');
const tableSearchInput = document.getElementById('table-search');
const itemSearchInput = document.getElementById('item-search');
const clearTableSearchBtn = document.getElementById('clear-table-search');
const clearItemSearchBtn = document.getElementById('clear-item-search');

// Global search elements
const globalItemSearchInput = document.getElementById('global-item-search');
const clearGlobalSearchBtn = document.getElementById('clear-global-search');
const toggleGlobalSearchBtn = document.getElementById('toggle-global-search');
const globalSearchView = document.getElementById('global-search-view');
const globalResults = document.getElementById('global-results');
const searchTermDisplay = document.getElementById('search-term-display');

// Compare view elements
const compareToggleBtn = document.getElementById('compare-mode-toggle');
const exitCompareBtn = document.getElementById('exit-compare');
const normalView = document.getElementById('normal-view');
const compareView = document.getElementById('compare-view');
const comparisonInfo = document.getElementById('comparison-info');
const table1Heading = document.getElementById('table1-heading');
const table2Heading = document.getElementById('table2-heading');
const table1Name = document.getElementById('table1-name');
const table2Name = document.getElementById('table2-name');
const table1Items = document.getElementById('table1-items');
const table2Items = document.getElementById('table2-items');

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
        
        // Add class if this is one of the selected tables
        if (tableName === currentTable) {
            li.classList.add('active');
        } else if (tableName === secondTable) {
            li.classList.add('active-second');
        }
        
        li.addEventListener('click', () => {
            // If compare mode is active, handle differently
            if (compareMode) {
                handleCompareTableSelection(tableName);
            } else {
                // Remove active class from all list items
                document.querySelectorAll('#tables-list li').forEach(item => {
                    item.classList.remove('active');
                });
                
                // Add active class to clicked item
                li.classList.add('active');
                
                // Display items for this table
                displayTableItems(tableName);
            }
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

// Handle table selection in compare mode
function handleCompareTableSelection(tableName) {
    // If already selected as primary table, do nothing
    if (tableName === currentTable) {
        return;
    }
    
    // If already selected as secondary table, swap
    if (tableName === secondTable) {
        const temp = currentTable;
        currentTable = secondTable;
        secondTable = temp;
        displayCompareTables();
        updateTableSelectionUI();
        return;
    }
    
    // If no primary table selected yet
    if (!currentTable) {
        currentTable = tableName;
        displayCompareTables();
        updateTableSelectionUI();
        return;
    }
    
    // If primary table is selected but no secondary
    if (!secondTable) {
        secondTable = tableName;
        displayCompareTables();
        updateTableSelectionUI();
        return;
    }
    
    // If both tables are selected, replace secondary
    secondTable = tableName;
    displayCompareTables();
    updateTableSelectionUI();
}

// Update the UI to reflect current table selections
function updateTableSelectionUI() {
    // Update table list selection highlighting
    document.querySelectorAll('#tables-list li').forEach(item => {
        item.classList.remove('active', 'active-second');
        
        const tableName = item.dataset.table;
        if (tableName === currentTable) {
            item.classList.add('active');
        } else if (tableName === secondTable) {
            item.classList.add('active-second');
        }
    });
    
    // Update comparison info section
    if (currentTable) {
        table1Name.textContent = currentTable;
    }
    
    if (secondTable) {
        table2Name.textContent = secondTable;
        comparisonInfo.classList.remove('hidden');
    } else {
        comparisonInfo.classList.add('hidden');
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

// Display comparison between two tables
function displayCompareTables() {
    if (!currentTable) {
        return;
    }
    
    // Update headings
    table1Heading.textContent = currentTable;
    table2Heading.textContent = secondTable || 'Select second table';
    
    // Clear existing items
    table1Items.innerHTML = '';
    table2Items.innerHTML = '';
    
    // Get items for first table
    const items1 = lootTables[currentTable] || [];
    
    // Get items for second table if selected
    const items2 = secondTable ? lootTables[secondTable] || [] : [];
    
    // Find unique items in both tables
    const uniqueToTable1 = secondTable 
        ? items1.filter(item => !items2.includes(item))
        : [];
        
    const uniqueToTable2 = secondTable 
        ? items2.filter(item => !items1.includes(item))
        : [];
    
    // Display items for first table
    if (items1.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No items in this loot table';
        table1Items.appendChild(li);
    } else {
        // Sort items alphabetically
        const sortedItems = [...items1].sort();
        
        sortedItems.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            
            // Highlight unique items
            if (secondTable && uniqueToTable1.includes(item)) {
                li.classList.add('unique-item');
            }
            
            table1Items.appendChild(li);
        });
    }
    
    // Display items for second table if selected
    if (!secondTable) {
        const li = document.createElement('li');
        li.textContent = 'Please select a second table for comparison';
        table2Items.appendChild(li);
    } else if (items2.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No items in this loot table';
        table2Items.appendChild(li);
    } else {
        // Sort items alphabetically
        const sortedItems = [...items2].sort();
        
        sortedItems.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            
            // Highlight unique items
            if (uniqueToTable2.includes(item)) {
                li.classList.add('unique-item');
            }
            
            table2Items.appendChild(li);
        });
    }
}

// Global search across all loot tables
function performGlobalSearch(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        return;
    }
    
    searchTerm = searchTerm.trim().toLowerCase();
    searchTermDisplay.textContent = `"${searchTerm}"`;
    globalResults.innerHTML = '';
    
    // Find all tables containing the search term in their items
    const matchingTables = {};
    
    Object.entries(lootTables).forEach(([tableName, items]) => {
        const matchingItems = items.filter(item => 
            item.toLowerCase().includes(searchTerm)
        );
        
        if (matchingItems.length > 0) {
            matchingTables[tableName] = matchingItems;
        }
    });
    
    // Display results
    if (Object.keys(matchingTables).length === 0) {
        globalResults.innerHTML = '<div class="no-results">No matches found</div>';
        return;
    }
    
    // Sort table names alphabetically
    const sortedTableNames = Object.keys(matchingTables).sort();
    
    // Create result elements
    sortedTableNames.forEach(tableName => {
        const tableResult = document.createElement('div');
        tableResult.className = 'table-result';
        
        const tableHeader = document.createElement('div');
        tableHeader.className = 'table-result-header';
        tableHeader.textContent = `${tableName} (${matchingTables[tableName].length} items)`;
        
        const itemsList = document.createElement('ul');
        itemsList.className = 'table-result-items';
        
        // Sort items alphabetically
        const sortedItems = [...matchingTables[tableName]].sort();
        
        sortedItems.forEach(item => {
            const li = document.createElement('li');
            
            // Highlight the matching part
            const itemText = item;
            const lowerItem = itemText.toLowerCase();
            const index = lowerItem.indexOf(searchTerm);
            
            if (index !== -1) {
                const before = itemText.substring(0, index);
                const match = itemText.substring(index, index + searchTerm.length);
                const after = itemText.substring(index + searchTerm.length);
                
                li.innerHTML = `${before}<strong>${match}</strong>${after}`;
            } else {
                li.textContent = item;
            }
            
            itemsList.appendChild(li);
        });
        
        // Add event to make table clickable
        tableHeader.addEventListener('click', () => {
            // Toggle display of items
            if (itemsList.style.display === 'none') {
                itemsList.style.display = 'block';
            } else {
                itemsList.style.display = 'none';
            }
        });
        
        tableResult.appendChild(tableHeader);
        tableResult.appendChild(itemsList);
        globalResults.appendChild(tableResult);
    });
}

// Toggle compare mode
function toggleCompareMode() {
    compareMode = !compareMode;
    
    if (compareMode) {
        // Enter compare mode
        compareToggleBtn.textContent = 'Selecting Tables...';
        normalView.classList.add('hidden');
        compareView.classList.remove('hidden');
        
        // Hide global search view if active
        globalSearchActive = false;
        globalSearchView.classList.add('hidden');
        toggleGlobalSearchBtn.textContent = 'Show Results';
        
        // Reset table selections if needed
        if (!currentTable) {
            comparisonInfo.classList.add('hidden');
        } else {
            displayCompareTables();
        }
    } else {
        // Exit compare mode
        exitCompareMode();
    }
}

// Exit compare mode
function exitCompareMode() {
    compareMode = false;
    compareToggleBtn.textContent = 'Compare Tables';
    normalView.classList.remove('hidden');
    compareView.classList.add('hidden');
    
    // If we had a selected table before, show it again
    if (currentTable) {
        displayTableItems(currentTable);
    }
}

// Toggle global search view
function toggleGlobalSearch() {
    globalSearchActive = !globalSearchActive;
    
    if (globalSearchActive) {
        // Show global search results
        toggleGlobalSearchBtn.textContent = 'Hide Results';
        normalView.classList.add('hidden');
        compareView.classList.add('hidden');
        globalSearchView.classList.remove('hidden');
        
        // Exit compare mode if active
        if (compareMode) {
            compareMode = false;
            compareToggleBtn.textContent = 'Compare Tables';
        }
        
        // Perform search if there's a term
        const searchTerm = globalItemSearchInput.value.trim();
        if (searchTerm) {
            performGlobalSearch(searchTerm);
        }
    } else {
        // Hide global search results
        toggleGlobalSearchBtn.textContent = 'Show Results';
        globalSearchView.classList.add('hidden');
        normalView.classList.remove('hidden');
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
    
    // Global search
    globalItemSearchInput.addEventListener('input', () => {
        const searchTerm = globalItemSearchInput.value.trim();
        if (globalSearchActive && searchTerm) {
            performGlobalSearch(searchTerm);
        }
    });
    
    globalItemSearchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            const searchTerm = globalItemSearchInput.value.trim();
            if (searchTerm) {
                if (!globalSearchActive) {
                    toggleGlobalSearch();
                } else {
                    performGlobalSearch(searchTerm);
                }
            }
        }
    });
    
    clearGlobalSearchBtn.addEventListener('click', () => {
        globalItemSearchInput.value = '';
        if (globalSearchActive) {
            globalResults.innerHTML = '<div class="no-results">Enter a search term above</div>';
            searchTermDisplay.textContent = '';
        }
    });
    
    toggleGlobalSearchBtn.addEventListener('click', toggleGlobalSearch);
}

// Setup comparison functionality
function setupCompare() {
    compareToggleBtn.addEventListener('click', toggleCompareMode);
    exitCompareBtn.addEventListener('click', exitCompareMode);
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
    setupCompare();
}

// Start the application when the page loads
window.addEventListener('DOMContentLoaded', init); 