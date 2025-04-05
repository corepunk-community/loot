// Global variables
let lootTables = {};
let currentTable = null;
let secondTable = null;
let compareMode = false;
let globalSearchActive = false;
let currentCategoryFilter = "all";

// DOM elements
const tablesList = document.getElementById('tables-list');
const itemsList = document.getElementById('items-list');
const selectedTableHeading = document.getElementById('selected-table');
const tableSearchInput = document.getElementById('table-search');
const itemSearchInput = document.getElementById('item-search');
const clearTableSearchBtn = document.getElementById('clear-table-search');
const clearItemSearchBtn = document.getElementById('clear-item-search');

// Tables selection for comparison
const tablesSelectionView = document.getElementById('tables-selection-view');
const compareTablesList = document.getElementById('compare-tables-list');
const compareTableSearchInput = document.getElementById('compare-table-search');
const clearCompareTableSearchBtn = document.getElementById('clear-compare-table-search');

// Comparison elements
const table1ItemSearch = document.getElementById('table1-item-search');
const table2ItemSearch = document.getElementById('table2-item-search');
const clearTable1SearchBtn = document.getElementById('clear-table1-search');
const clearTable2SearchBtn = document.getElementById('clear-table2-search');

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

// Category filter elements
const filterButtons = document.querySelectorAll('.filter-btn');

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

// Determine category based on table name
function getTableCategory(tableName) {
    const lowerName = tableName.toLowerCase();
    
    if (lowerName.includes('camp chest')) return 'camp chest';
    if (lowerName.includes('creeps')) return 'creeps';
    if (lowerName.includes('destroyable')) return 'destroyable';
    if (lowerName.includes('dungeon boss')) return 'dungeon boss';
    if (lowerName.includes('gathering')) return 'gathering';
    if (lowerName.includes('monster')) return 'monster';
    if (lowerName.includes('poi chest')) return 'poi chest';
    if (lowerName.includes('reactive')) return 'reactive';
    if (lowerName.includes('searchable')) return 'searchable';
    
    return 'other';
}

// Apply category and search filters
function applyFilters() {
    const searchTerm = tableSearchInput.value.trim().toLowerCase();
    
    // Get all table elements
    const tableItems = document.querySelectorAll('#tables-list li');
    
    let visibleCount = 0;
    
    tableItems.forEach(item => {
        const tableName = item.textContent;
        const category = getTableCategory(tableName);
        const matchesCategory = currentCategoryFilter === 'all' || category === currentCategoryFilter;
        const matchesSearch = !searchTerm || tableName.toLowerCase().includes(searchTerm);
        
        // Show/hide based on both filters
        if (matchesCategory && matchesSearch) {
            item.classList.remove('hidden-table');
            visibleCount++;
        } else {
            item.classList.add('hidden-table');
        }
    });
    
    // Check if no tables are visible and show a message if needed
    if (visibleCount === 0) {
        let noResultsMsg = document.getElementById('no-results-msg');
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('li');
            noResultsMsg.id = 'no-results-msg';
            noResultsMsg.textContent = 'No matching tables found';
            noResultsMsg.style.cursor = 'default';
            noResultsMsg.classList.add('no-tables-message');
            tablesList.appendChild(noResultsMsg);
        }
    } else {
        const noResultsMsg = document.getElementById('no-results-msg');
        if (noResultsMsg) {
            noResultsMsg.remove();
        }
    }
}

// Apply filters for comparison table list
function applyCompareFilters() {
    const searchTerm = compareTableSearchInput.value.trim().toLowerCase();
    
    // Get all table elements
    const tableItems = document.querySelectorAll('#compare-tables-list li');
    
    let visibleCount = 0;
    
    tableItems.forEach(item => {
        const tableName = item.textContent;
        const matchesSearch = !searchTerm || tableName.toLowerCase().includes(searchTerm);
        
        // Show/hide based on search term
        if (matchesSearch) {
            item.classList.remove('hidden-table');
            visibleCount++;
        } else {
            item.classList.add('hidden-table');
        }
    });
    
    // Check if no tables are visible and show a message if needed
    if (visibleCount === 0) {
        let noResultsMsg = document.getElementById('compare-no-results-msg');
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('li');
            noResultsMsg.id = 'compare-no-results-msg';
            noResultsMsg.textContent = 'No matching tables found';
            noResultsMsg.style.cursor = 'default';
            noResultsMsg.classList.add('no-tables-message');
            compareTablesList.appendChild(noResultsMsg);
        }
    } else {
        const noResultsMsg = document.getElementById('compare-no-results-msg');
        if (noResultsMsg) {
            noResultsMsg.remove();
        }
    }
}

// Populate tables list
function populateTablesList() {
    tablesList.innerHTML = '';
    
    // Sort table names alphabetically
    const sortedTableNames = Object.keys(lootTables).sort();
    
    sortedTableNames.forEach(tableName => {
        const li = document.createElement('li');
        li.textContent = tableName;
        li.dataset.table = tableName;
        li.dataset.category = getTableCategory(tableName);
        
        // Add class if this is one of the selected tables
        if (tableName === currentTable) {
            li.classList.add('active');
        } else if (tableName === secondTable) {
            li.classList.add('active-second');
        }
        
        // Apply current filters
        const category = getTableCategory(tableName);
        if (currentCategoryFilter !== 'all' && category !== currentCategoryFilter) {
            li.classList.add('hidden-table');
        }
        
        li.addEventListener('click', () => {
            // Always handle as normal table selection in this view
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
    
    // Apply search filter if there's already a term
    if (tableSearchInput.value.trim()) {
        applyFilters();
    }
}

// Populate tables list for comparison mode
function populateCompareTablesList() {
    compareTablesList.innerHTML = '';
    
    // Sort table names alphabetically
    const sortedTableNames = Object.keys(lootTables).sort();
    
    sortedTableNames.forEach(tableName => {
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
            handleCompareTableSelection(tableName);
        });
        
        compareTablesList.appendChild(li);
    });
    
    // Apply search filter if there's already a term
    if (compareTableSearchInput.value.trim()) {
        applyCompareFilters();
    }
}

// Handle table selection in compare mode
function handleCompareTableSelection(tableName) {
    // If no primary table selected yet
    if (!currentTable) {
        currentTable = tableName;
        
        // Update the UI
        updateTableSelectionUI();
        
        // If we now have both tables, move to compare view
        if (currentTable && secondTable) {
            showCompareView();
        }
        return;
    }
    
    // If primary table is selected but no secondary
    if (!secondTable) {
        // Don't allow selecting the same table twice
        if (tableName === currentTable) {
            return;
        }
        
        secondTable = tableName;
        
        // Update the UI
        updateTableSelectionUI();
        
        // Now we have both tables, move to compare view
        showCompareView();
        return;
    }
    
    // If both tables are already selected, allow changing second table
    if (tableName !== currentTable) {
        secondTable = tableName;
        updateTableSelectionUI();
        displayCompareTables();
    }
}

// Show the compare view with both tables
function showCompareView() {
    // Hide tables selection view
    tablesSelectionView.classList.add('hidden');
    
    // Show compare view
    compareView.classList.remove('hidden');
    
    // Update button text
    compareToggleBtn.textContent = 'Compare Mode';
    
    // Show comparison info
    comparisonInfo.classList.remove('hidden');
    
    // Display the tables comparison
    displayCompareTables();
}

// Update the UI to reflect current table selections
function updateTableSelectionUI() {
    // Update selection list highlighting
    document.querySelectorAll('#compare-tables-list li').forEach(item => {
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
        table1Heading.textContent = currentTable;
    }
    
    if (secondTable) {
        table2Name.textContent = secondTable;
        table2Heading.textContent = secondTable;
    } else {
        table2Heading.textContent = 'Select second table';
    }
    
    // Clear comparison search inputs
    table1ItemSearch.value = '';
    table2ItemSearch.value = '';
}

// Filter items in a list based on search term
function filterItems(items, searchTerm, containerElement) {
    containerElement.innerHTML = '';
    
    if (!items || items.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No items in this loot table';
        containerElement.appendChild(li);
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
        containerElement.appendChild(li);
    });
    
    if (itemsFound === 0) {
        const li = document.createElement('li');
        li.textContent = 'No matching items found';
        li.classList.add('no-items-message');
        containerElement.appendChild(li);
    }
}

// Display items for a specific table
function displayTableItems(tableName, searchTerm = '') {
    currentTable = tableName;
    selectedTableHeading.textContent = tableName;
    
    const items = lootTables[tableName];
    filterItems(items, searchTerm, itemsList);
}

// Display comparison between two tables
function displayCompareTables() {
    if (!currentTable) {
        return;
    }
    
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
    
    // Apply search filters
    const searchTerm1 = table1ItemSearch.value.trim();
    const searchTerm2 = table2ItemSearch.value.trim();
    
    // Display items for first table
    if (items1.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No items in this loot table';
        li.classList.add('no-items-message');
        table1Items.appendChild(li);
    } else {
        // Sort items alphabetically
        const sortedItems = [...items1].sort();
        let itemsFound = 0;
        
        sortedItems.forEach(item => {
            // Apply search filter
            if (searchTerm1 && !item.toLowerCase().includes(searchTerm1.toLowerCase())) {
                return;
            }
            
            itemsFound++;
            const li = document.createElement('li');
            li.textContent = item;
            
            // Highlight unique items
            if (secondTable && uniqueToTable1.includes(item)) {
                li.classList.add('unique-item');
            }
            
            table1Items.appendChild(li);
        });
        
        if (itemsFound === 0) {
            const li = document.createElement('li');
            li.textContent = 'No matching items found';
            li.classList.add('no-items-message');
            table1Items.appendChild(li);
        }
    }
    
    // Display items for second table if selected
    if (!secondTable) {
        const li = document.createElement('li');
        li.textContent = 'Please select a second table for comparison';
        li.classList.add('no-items-message');
        table2Items.appendChild(li);
    } else if (items2.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No items in this loot table';
        li.classList.add('no-items-message');
        table2Items.appendChild(li);
    } else {
        // Sort items alphabetically
        const sortedItems = [...items2].sort();
        let itemsFound = 0;
        
        sortedItems.forEach(item => {
            // Apply search filter
            if (searchTerm2 && !item.toLowerCase().includes(searchTerm2.toLowerCase())) {
                return;
            }
            
            itemsFound++;
            const li = document.createElement('li');
            li.textContent = item;
            
            // Highlight unique items
            if (uniqueToTable2.includes(item)) {
                li.classList.add('unique-item');
            }
            
            table2Items.appendChild(li);
        });
        
        if (itemsFound === 0) {
            const li = document.createElement('li');
            li.textContent = 'No matching items found';
            li.classList.add('no-items-message');
            table2Items.appendChild(li);
        }
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
        tableResult.className = 'result-table';
        
        const tableHeader = document.createElement('div');
        tableHeader.className = 'result-table-header';
        tableHeader.textContent = `${tableName} (${matchingTables[tableName].length} items)`;
        
        const itemsList = document.createElement('ul');
        itemsList.className = 'result-items';
        
        // Sort items alphabetically
        const sortedItems = [...matchingTables[tableName]].sort();
        
        sortedItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'result-item';
            
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
        
        // Add button to view full table
        const viewTableBtn = document.createElement('button');
        viewTableBtn.className = 'view-table-btn';
        viewTableBtn.textContent = 'View Full Table';
        viewTableBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent toggling the items list
            exitGlobalSearchAndViewTable(tableName);
        });
        
        tableHeader.appendChild(viewTableBtn);
        tableResult.appendChild(tableHeader);
        tableResult.appendChild(itemsList);
        globalResults.appendChild(tableResult);
    });
}

// Exit global search and view a specific table
function exitGlobalSearchAndViewTable(tableName) {
    // Exit global search mode
    globalSearchActive = false;
    toggleGlobalSearchBtn.textContent = 'Show Results';
    globalSearchView.classList.add('hidden');
    
    // Show normal view
    normalView.classList.remove('hidden');
    
    // Display the table
    currentTable = tableName;
    
    // Update the UI to show the selected table
    document.querySelectorAll('#tables-list li').forEach(item => {
        item.classList.remove('active');
        
        if (item.dataset.table === tableName) {
            item.classList.add('active');
            // Ensure the table is visible by scrolling to it
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
    
    // Display items for this table
    displayTableItems(tableName);
}

// Toggle compare mode
function toggleCompareMode() {
    compareMode = !compareMode;
    
    if (compareMode) {
        // Enter compare mode
        compareToggleBtn.textContent = 'Selecting Tables...';
        
        // Hide normal view
        normalView.classList.add('hidden');
        
        // Reset table selections
        currentTable = null;
        secondTable = null;
        
        // Set up and show tables selection view
        populateCompareTablesList();
        tablesSelectionView.classList.remove('hidden');
        compareView.classList.add('hidden');
        
        // Hide comparison info until tables are selected
        comparisonInfo.classList.add('hidden');
        
        // Hide global search view if active
        globalSearchActive = false;
        globalSearchView.classList.add('hidden');
        toggleGlobalSearchBtn.textContent = 'Show Results';
    } else {
        // Exit compare mode
        exitCompareMode();
    }
}

// Exit compare mode
function exitCompareMode() {
    compareMode = false;
    compareToggleBtn.textContent = 'Compare Tables';
    
    // Reset and hide compare views
    normalView.classList.remove('hidden');
    tablesSelectionView.classList.add('hidden');
    compareView.classList.add('hidden');
    
    // Reset table selections
    currentTable = null;
    secondTable = null;
    
    // Reset the selection heading
    selectedTableHeading.textContent = 'Select a loot table';
    
    // Clear the items list
    itemsList.innerHTML = '';
}

// Toggle global search view
function toggleGlobalSearch() {
    globalSearchActive = !globalSearchActive;
    
    if (globalSearchActive) {
        // Show global search results
        toggleGlobalSearchBtn.textContent = 'Hide Results';
        normalView.classList.add('hidden');
        tablesSelectionView.classList.add('hidden');
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

// Setup category filter functionality
function setupCategoryFilter() {
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            filterButtons.forEach(btn => btn.classList.remove('active'));
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Set current filter
            currentCategoryFilter = button.dataset.filter;
            
            // Apply filters
            applyFilters();
        });
    });
    
    // Set "All" as active by default
    document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
}

// Search functionality
function setupSearch() {
    // Main table search
    tableSearchInput.addEventListener('input', () => {
        applyFilters();
    });
    
    // Item search in selected table
    itemSearchInput.addEventListener('input', () => {
        if (currentTable) {
            displayTableItems(currentTable, itemSearchInput.value.trim());
        }
    });
    
    // Compare table search
    compareTableSearchInput.addEventListener('input', () => {
        applyCompareFilters();
    });
    
    // Clear buttons
    clearTableSearchBtn.addEventListener('click', () => {
        tableSearchInput.value = '';
        applyFilters();
    });
    
    clearItemSearchBtn.addEventListener('click', () => {
        itemSearchInput.value = '';
        if (currentTable) {
            displayTableItems(currentTable);
        }
    });
    
    clearCompareTableSearchBtn.addEventListener('click', () => {
        compareTableSearchInput.value = '';
        applyCompareFilters();
    });
    
    // Comparison view search
    table1ItemSearch.addEventListener('input', () => {
        displayCompareTables();
    });
    
    table2ItemSearch.addEventListener('input', () => {
        displayCompareTables();
    });
    
    clearTable1SearchBtn.addEventListener('click', () => {
        table1ItemSearch.value = '';
        displayCompareTables();
    });
    
    clearTable2SearchBtn.addEventListener('click', () => {
        table2ItemSearch.value = '';
        displayCompareTables();
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
    setupCategoryFilter();
}

// Start the application when the page loads
window.addEventListener('DOMContentLoaded', init); 