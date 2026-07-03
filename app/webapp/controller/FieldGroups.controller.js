sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/ActionSheet",
    "sap/m/Button",
    "mdm/portal/util/ColumnSettings"
], function (
    Controller, Filter, FilterOperator, Sorter,
    JSONModel, MessageToast, MessageBox, ActionSheet, Button,
    ColumnSettings
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.FieldGroups", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            var oUiModel = new JSONModel({
                mainCount    : 0,
                subCount     : 0,
                selectedClass: "",         // current object-class filter (empty = all)
                subGroupCounts: {},        // { groupId: number }
                fieldCounts   : {}         // { groupId: number }
            });
            this.getView().setModel(oUiModel, "ui");

            var oFiltersModel = new JSONModel({
                parentGroups: [{ key: "", text: "All" }]
            });
            this.getView().setModel(oFiltersModel, "filters");

            // Load parent-group dropdown
            this._loadParentGroups(oFiltersModel);
            // Pre-load MDT IDs grouped by object_class for toggle filter
            this._loadMasterDataTypeIds();

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("fieldGroups").attachPatternMatched(this._onRouteMatched, this);

            this._oColumnSettings = ColumnSettings(this, {
                storageKey: "mdmportal.fieldGroups.columnVisibility",
                columns: [
                    { id: "colDescription", label: "Description" },
                    { id: "colType",        label: "Type" },
                    { id: "colParent",      label: "Parent Group" },
                    { id: "colIcon",        label: "Icon" },
                    { id: "colSequence",    label: "Sequence" },
                    { id: "colSubGroups",   label: "Sub Groups" },
                    { id: "colFields",      label: "Fields" },
                    { id: "colStatus",      label: "Status" }
                ]
            });
            this._oColumnSettings.init();
        },

        onColumnSettings: function () {
            this._oColumnSettings.open();
        },

        _onRouteMatched: function () {
            var oTable = this.byId("groupTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
                // Force a server re-read so changes saved on the detail page
                // appear when returning to the list (avoids stale cached rows).
                oBinding.refresh();
            } else {
                this.getView().attachEventOnce("afterRendering", function () {
                    var oB = this.byId("groupTable").getBinding("items");
                    if (oB) {
                        oB.attachEventOnce("dataReceived", this._onDataReceived, this);
                    }
                }, this);
            }
            // Reapply object-class filter from current toggle selection
            this._applyFilters();
        },

        // ── Data received — update counts ────────────────────────────
        _onDataReceived: function () {
            var oBinding = this.byId("groupTable").getBinding("items");
            if (!oBinding) { return; }

            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iTotal) {
                    this.byId("tableTitle").setText("Groups (" + (iTotal || 0) + ")");
                }.bind(this));
            }

            // Count main vs sub groups from loaded contexts
            var aCtx = oBinding.getCurrentContexts();
            var iMain = 0, iSub = 0;
            var oSubCounts = {};
            var oFieldCounts = {};

            aCtx.forEach(function (oCtx) {
                var sParent = oCtx.getProperty("parent_group_id_group_id");
                if (sParent) {
                    iSub++;
                    oSubCounts[sParent] = (oSubCounts[sParent] || 0) + 1;
                } else {
                    iMain++;
                }
            });

            var oUiModel = this.getView().getModel("ui");
            oUiModel.setProperty("/mainCount", iMain);
            oUiModel.setProperty("/subCount",  iSub);
            oUiModel.setProperty("/subGroupCounts", oSubCounts);

            // Load field counts per group (main groups only) from FieldMasters
            this._loadFieldCounts(aCtx, oFieldCounts);
        },

        _loadFieldCounts: function (aCtx, oFieldCounts) {
            // For each group, count how many FieldMasters reference it as main_group or sub_group
            var oModel    = this.getOwnerComponent().getModel();
            var oUiModel  = this.getView().getModel("ui");
            var aGroupIds = aCtx.map(function (c) { return c.getProperty("group_id"); });
            if (!aGroupIds.length) { return; }

            // Request FieldMasters with only group keys (lightweight)
            oModel.bindList("/FieldMasters", null, null, null, {
                $select: "field_id,main_group_group_id,sub_group_group_id"
            }).requestContexts(0, Infinity).then(function (aFields) {
                aFields.forEach(function (oCtx) {
                    var sMain = oCtx.getProperty("main_group_group_id");
                    var sSub  = oCtx.getProperty("sub_group_group_id");
                    if (sMain) { oFieldCounts[sMain] = (oFieldCounts[sMain] || 0) + 1; }
                    if (sSub)  { oFieldCounts[sSub]  = (oFieldCounts[sSub]  || 0) + 1; }
                });
                oUiModel.setProperty("/fieldCounts", oFieldCounts);
            }).catch(function () {
                // field counts are decorative — swallow errors silently
            });
        },

        // ── Load MDT IDs by object class (for toggle filter) ────────
        _loadMasterDataTypeIds: function () {
            var oModel = this.getOwnerComponent().getModel();
            this._oBpMdtIds       = {};
            this._oMaterialMdtIds = {};
            oModel.bindList("/MasterDataTypes", null, null, null, {
                $select: "master_data_type_id,object_class"
            }).requestContexts(0, 50).then(function (aCtx) {
                aCtx.forEach(function (oCtx) {
                    var sId    = oCtx.getProperty("master_data_type_id");
                    var sClass = oCtx.getProperty("object_class");
                    if (sClass === "BP")       { this._oBpMdtIds[sId]       = true; }
                    else if (sClass === "MATERIAL") { this._oMaterialMdtIds[sId] = true; }
                }.bind(this));
            }.bind(this)).catch(function () {});
        },

                // ── Parent-group dropdown ────────────────────────────────────
        _loadParentGroups: function (oFiltersModel) {
            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/FieldGroups", null, [new Sorter("sequence")])
                .requestContexts(0, Infinity)
                .then(function (aCtx) {
                    var aItems = [{ key: "", text: "All" }];
                    aCtx.forEach(function (oCtx) {
                        if (!oCtx.getProperty("parent_group_id_group_id")) {
                            // Only main groups can be parents
                            aItems.push({
                                key : oCtx.getProperty("group_id"),
                                text: oCtx.getProperty("group_id") + " — " + oCtx.getProperty("description")
                            });
                        }
                    });
                    oFiltersModel.setProperty("/parentGroups", aItems);
                });
        },

        // ── Object-class toggle ──────────────────────────────────────
        onObjectClassChange: function (oEvent) {
            var sKey = oEvent.getParameter("item").getKey();
            this.getView().getModel("ui").setProperty("/selectedClass", sKey);
            this._applyFilters();
        },

        // ── Formatter: count badge from a counts map ─────────────────
        // ── Formatters: active status ────────────────────────────────
        formatActiveText: function (vActive) {
            return this._isActive(vActive) ? "Active" : "Inactive";
        },
        formatActiveState: function (vActive) {
            return this._isActive(vActive) ? "Success" : "Error";
        },
        _isActive: function (vActive) {
            if (typeof vActive === "string") {
                var s = vActive.trim().toLowerCase();
                return (s === "yes" || s === "true" || s === "1" || s === "active" || s === "x");
            }
            return vActive === true || vActive === 1;
        },

        formatCount: function (sGroupId, oCounts) {
            if (!sGroupId || !oCounts) { return "\u2014"; }
            var iCount = oCounts[sGroupId];
            return (iCount === undefined || iCount === null) ? "\u2014" : String(iCount);
        },

        // ── Formatters: Main Group vs Sub Group chip ─────────────────
        formatTypeText: function (sParentId) {
            return sParentId ? "Sub Group" : "Main Group";
        },
        formatTypeState: function (sParentId) {
            return sParentId ? "None" : "Information";
        },
        formatTypeInverted: function (sParentId) {
            // Main groups get an inverted (filled) chip; sub groups plain.
            return !sParentId;
        },
        formatParent: function (sParentId) {
            return sParentId ? sParentId : "\u2014";
        },

        // ── Filter handlers ──────────────────────────────────────────
        onFilterLiveChange: function () { this._applyFilters(); },
        onFilterChange    : function () { this._applyFilters(); },
        onGo              : function () { this._applyFilters(); },

        _applyFilters: function () {
            var sSearch    = this.byId("filterSearch").getValue();
            var sGroupType = this.byId("filterGroupType").getSelectedKey();
            var sParent    = this.byId("filterParent").getSelectedKey();
            var sActive    = this.byId("filterStatus").getSelectedKey();
            var sClass     = this.getView().getModel("ui").getProperty("/selectedClass");

            var aFilters = [];

            // Object class filter — use FK IDs collected at load time (avoids nav property filter)
            if (sClass && this._oBpMdtIds && this._oMaterialMdtIds) {
                var aIds = sClass === "BP"
                    ? Object.keys(this._oBpMdtIds)
                    : Object.keys(this._oMaterialMdtIds);
                if (aIds.length === 1) {
                    aFilters.push(new Filter("master_data_type_master_data_type_id", FilterOperator.EQ, aIds[0]));
                } else if (aIds.length > 1) {
                    aFilters.push(new Filter({
                        filters: aIds.map(function (sId) {
                            return new Filter("master_data_type_master_data_type_id", FilterOperator.EQ, sId);
                        }),
                        and: false
                    }));
                }
            }

            // Search
            if (sSearch) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter({ path: "group_id", operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false }),
                        new Filter({ path: "description", operator: FilterOperator.Contains, value1: sSearch, caseSensitive: false })
                    ],
                    and: false
                }));
            }

            // Group type: Main = no parent, Sub = has parent
            if (sGroupType === "MAIN") {
                aFilters.push(new Filter("parent_group_id_group_id", FilterOperator.EQ, null));
            } else if (sGroupType === "SUB") {
                aFilters.push(new Filter("parent_group_id_group_id", FilterOperator.NE, null));
            }

            // Parent group filter
            if (sParent) {
                aFilters.push(new Filter("parent_group_id_group_id", FilterOperator.EQ, sParent));
            }

            // Status
            if (sActive !== "") {
                aFilters.push(new Filter("active", FilterOperator.EQ, sActive === "true"));
            }

            var oBinding = this.byId("groupTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter(
                aFilters.length ? [new Filter({ filters: aFilters, and: true })] : []
            );
            oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
        },

        onClearFilters: function () {
            this.byId("filterSearch").setValue("");
            this.byId("filterGroupType").setSelectedKey("");
            this.byId("filterParent").setSelectedKey("");
            this.byId("filterStatus").setSelectedKey("");
            var oBinding = this.byId("groupTable").getBinding("items");
            if (oBinding) {
                oBinding.filter([]);
                oBinding.attachEventOnce("dataReceived", this._onDataReceived, this);
            }
        },

        // ── Multi-select toolbar ─────────────────────────────────────
        onSelectionChange: function () {
            var bHas = this.byId("groupTable").getSelectedItems().length > 0;
            this.byId("bulkActivateBtn").setVisible(bHas);
            this.byId("bulkDeleteBtn").setVisible(bHas);
            this.byId("bulkSeparator").setVisible(bHas);
        },

        onBulkActivate: function () {
            var aSelected = this.byId("groupTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Activate " + aSelected.length + " group(s)?", {
                title  : "Confirm Activation",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        var aPromises = aSelected.map(function (oItem) {
                            return oItem.getBindingContext().setProperty("active", true);
                        });
                        Promise.all(aPromises)
                            .then(function () {
                                return this.getOwnerComponent().getModel().submitBatch("$auto");
                            }.bind(this))
                            .then(function () { MessageToast.show("Activated successfully."); })
                            .catch(function (e) { MessageBox.error("Activation failed: " + e.message); });
                    }
                }.bind(this)
            });
        },

        onBulkDelete: function () {
            var aSelected = this.byId("groupTable").getSelectedItems();
            if (!aSelected.length) { return; }
            MessageBox.confirm("Delete " + aSelected.length + " group(s)? This cannot be undone.", {
                title  : "Confirm Deletion",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        var aPromises = aSelected.map(function (oItem) {
                            return oItem.getBindingContext().delete("$auto");
                        });
                        Promise.all(aPromises)
                            .then(function () { MessageToast.show("Deleted successfully."); })
                            .catch(function (e) { MessageBox.error("Delete failed: " + e.message); });
                    }
                }.bind(this)
            });
        },

        // ── Row context menu ─────────────────────────────────────────
        onRowMenuPress: function (oEvent) {
            var oButton = oEvent.getSource();
            var oCtx    = oButton.getBindingContext();

            if (!this._oActionSheet) {
                this._oActionSheet = new ActionSheet({
                    buttons: [
                        new Button({ text: "Edit",       icon: "sap-icon://edit",    press: this._onMenuEdit.bind(this) }),
                        new Button({ text: "Add Sub-Group", icon: "sap-icon://add-subfolder", press: this._onMenuAddSub.bind(this) }),
                        new Button({ text: "Duplicate",  icon: "sap-icon://copy",    press: function () { MessageToast.show("Duplicate — coming soon"); } }),
                        new Button({ text: "Deactivate", icon: "sap-icon://decline", press: this._onMenuDeactivate.bind(this) })
                    ]
                });
                this.getView().addDependent(this._oActionSheet);
            }
            // Store context so menu handlers can access it
            this._oMenuCtx = oCtx;
            this._oActionSheet.openBy(oButton);
        },

        _onMenuEdit: function () {
            var sGroupId = this._oMenuCtx.getProperty("group_id");
            this.getOwnerComponent().getRouter().navTo("fieldGroupDetail", {
                groupId: encodeURIComponent(sGroupId.toLowerCase())
            });
        },

        _onMenuAddSub: function () {
            var sGroupId = this._oMenuCtx.getProperty("group_id");
            this.getOwnerComponent().getRouter().navTo("fieldGroupDetail", {
                groupId: "NEW_SUB_" + encodeURIComponent(sGroupId)
            });
        },

        _onMenuDeactivate: function () {
            this._oMenuCtx.setProperty("active", false);
            this.getOwnerComponent().getModel().submitBatch("$auto")
                .then(function () { MessageToast.show("Group deactivated."); })
                .catch(function (e) { MessageBox.error("Failed: " + e.message); });
        },

        // ── Navigation ───────────────────────────────────────────────
        onGroupLinkPress: function (oEvent) {
            var sGroupId = oEvent.getSource().getBindingContext().getProperty("group_id");
            this.getOwnerComponent().getRouter().navTo("fieldGroupDetail", {
                groupId: encodeURIComponent(sGroupId.toLowerCase())
            });
        },

        onRowPress: function (oEvent) {
            var sGroupId = oEvent.getSource().getBindingContext().getProperty("group_id");
            this.getOwnerComponent().getRouter().navTo("fieldGroupDetail", {
                groupId: encodeURIComponent(sGroupId.toLowerCase())
            });
        },

        onAdd: function () {
            this.getOwnerComponent().getRouter().navTo("fieldGroupDetail", { groupId: "NEW" });
        },

        // ── Export ───────────────────────────────────────────────────
        onExport: function () {
            var oBinding = this.byId("groupTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.requestContexts(0, oBinding.getLength()).then(function (aCtx) {
                var aData = aCtx.map(function (oCtx) {
                    return {
                        "Field Group Name" : oCtx.getProperty("group_id"),
                        "Description" : oCtx.getProperty("description"),
                        "Type"        : oCtx.getProperty("parent_group_id_group_id") ? "Sub Group" : "Main Group",
                        "Parent"      : oCtx.getProperty("parent_group_id_group_id") || "—",
                        "Sequence"    : oCtx.getProperty("sequence"),
                        "Active"      : oCtx.getProperty("active") ? "Yes" : "No"
                    };
                });
                this._downloadCSV(aData, "field-groups.csv");
            }.bind(this)).catch(function (e) {
                MessageBox.error("Export failed: " + e.message);
            });
        },

        _downloadCSV: function (aData, sFilename) {
            if (!aData || !aData.length) { MessageToast.show("No data to export."); return; }
            var aKeys = Object.keys(aData[0]);
            var sCSV  = aKeys.join(",") + "\n" +
                aData.map(function (r) {
                    return aKeys.map(function (k) {
                        return '"' + String(r[k] !== undefined ? r[k] : "").replace(/"/g, '""') + '"';
                    }).join(",");
                }).join("\n");
            var oBlob = new Blob([sCSV], { type: "text/csv;charset=utf-8;" });
            var sUrl  = URL.createObjectURL(oBlob);
            var oLink = document.createElement("a");
            oLink.href = sUrl; oLink.download = sFilename; oLink.click();
            URL.revokeObjectURL(sUrl);
        }
    });
});