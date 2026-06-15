sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/ActionSheet",
    "sap/m/Button",
    "sap/m/MessageBox"
], function (
    Controller, Filter, FilterOperator, Sorter,
    JSONModel, MessageToast, ActionSheet, Button, MessageBox
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.FieldMaster", {

        onInit: function () {
            var oFiltersModel = new JSONModel({
                masterDataTypes : [],
                mainGroups      : [],
                displayTypes    : [],
                displayTypeMap  : {}
            });
            this.getView().setModel(oFiltersModel, "filters");

            var oUiModel = new JSONModel({
                totalFields    : 0,
                activeFields   : 0,
                inactiveFields : 0
            });
            this.getView().setModel(oUiModel, "ui");

            this._loadMasterDataTypes(oFiltersModel);
            this._loadMainGroups(oFiltersModel);
            this._loadDisplayTypes(oFiltersModel);

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("fieldMaster").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Route matched ────────────────────────────────────────────────
        _onRouteMatched: function () {
            // FIX: In OData v4, the table's list binding is created lazily
            // during the view's rendering phase — NOT during onInit or even
            // immediately when the route fires. Calling getBinding("items")
            // here may still return undefined on the first match if the view
            // hasn't rendered yet.
            //
            // Safe pattern: use afterRendering (fires once, after DOM + bindings
            // are ready) for the first attachment, then re-attach on subsequent
            // route matches when the binding is guaranteed to exist.
            var oTable = this.byId("fieldTable");
            if (!oTable) { return; }

            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                // Subsequent route matches — binding already exists
                oBinding.attachEventOnce("dataReceived", this._updateCount, this);
                // Re-read from the server so edits saved on the detail page
                // (status changes, new fields) appear when returning to the list.
                oBinding.refresh();
            } else {
                // First route match — wait for view to finish rendering
                this.getView().attachEventOnce("afterRendering", function () {
                    var oB = this.byId("fieldTable").getBinding("items");
                    if (oB) {
                        oB.attachEventOnce("dataReceived", this._updateCount, this);
                    }
                }, this);
            }
        },

        // ── Count update ─────────────────────────────────────────────────
        _updateCount: function (oEvent) {
            var iCount = 0;
            // OData v4 $count is in the binding, not in the event data payload.
            // getLength() returns the binding's currently loaded row count.
            // For an exact server count, use the header context.
            var oBinding = this.byId("fieldTable").getBinding("items");
            if (oBinding) {
                // Try header context $count first (requires $count:true in binding params)
                var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
                if (oHeaderCtx) {
                    oHeaderCtx.requestProperty("$count").then(function (iServerCount) {
                        this.getView().getModel("ui")
                            .setProperty("/totalFields", iServerCount || 0);
                        var oTitle = this.byId("tableTitle");
                        if (oTitle) {
                            oTitle.setText("Fields (" + (iServerCount || 0) + ")");
                        }
                    }.bind(this));
                    return; // async path handles the update
                }
                // Fallback: use loaded row count
                iCount = oBinding.getLength();
            }
            this.getView().getModel("ui").setProperty("/totalFields", iCount);
            var oTitle = this.byId("tableTitle");
            if (oTitle) { oTitle.setText("Fields (" + iCount + ")"); }
        },

        // ── Named formatter for Display Type ─────────────────────────────
        // Referenced in view as: formatter: '.formatDisplayType'
        // Replaces the inline function() that the XML parser rejects.
        formatDisplayType: function (sCode, oMap) {
            if (!sCode) { return "—"; }
            if (!oMap || typeof oMap !== "object") { return sCode; }
            return oMap[sCode] || sCode;
        },

        // ── Load filter dropdowns ────────────────────────────────────────
        _loadMasterDataTypes: function (oFiltersModel) {
            var oODataModel = this.getOwnerComponent().getModel();
            oODataModel
                .bindList("/MasterDataTypes", null, [new Sorter("sequence")])
                .requestContexts(0, Infinity)
                .then(function (aContexts) {
                    var aItems = [{ key: "", text: "All types" }];
                    aContexts.forEach(function (oCtx) {
                        aItems.push({
                            key : oCtx.getProperty("master_data_type_id"),
                            text: oCtx.getProperty("description")
                        });
                    });
                    oFiltersModel.setProperty("/masterDataTypes", aItems);
                })
                .catch(function (oErr) {
                    MessageToast.show("Could not load Master Data Types: " + oErr.message);
                });
        },

        _loadMainGroups: function (oFiltersModel) {
            var oODataModel = this.getOwnerComponent().getModel();
            oODataModel
                .bindList("/FieldGroups", null, [new Sorter("sequence")])
                .requestContexts(0, Infinity)
                .then(function (aContexts) {
                    var aItems = [{ key: "", text: "All groups" }];
                    aContexts.forEach(function (oCtx) {
                        var sParent = oCtx.getProperty("parent_group_id_group_id");
                        if (!sParent) {
                            aItems.push({
                                key : oCtx.getProperty("group_id"),
                                text: oCtx.getProperty("description")
                            });
                        }
                    });
                    oFiltersModel.setProperty("/mainGroups", aItems);
                })
                .catch(function (oErr) {
                    MessageToast.show("Could not load Field Groups: " + oErr.message);
                });
        },

        _loadDisplayTypes: function (oFiltersModel) {
            var oODataModel = this.getOwnerComponent().getModel();
            oODataModel
                .bindList("/MetaDisplayTypes", null, [new Sorter("sequence")])
                .requestContexts(0, Infinity)
                .then(function (aContexts) {
                    var aItems = [{ key: "", text: "All displays" }];
                    var oMap   = {};
                    aContexts.forEach(function (oCtx) {
                        var sKey  = oCtx.getProperty("display_type_id");
                        var sText = oCtx.getProperty("display_type_name");
                        aItems.push({ key: sKey, text: sText });
                        oMap[sKey] = sText;
                    });
                    oFiltersModel.setProperty("/displayTypes", aItems);
                    oFiltersModel.setProperty("/displayTypeMap", oMap);
                })
                .catch(function () {
                    var aFallback = [
                        { key: "",            text: "All displays" },
                        { key: "FREE_INPUT",  text: "Free Input"   },
                        { key: "DROPDOWN",    text: "Dropdown"     },
                        { key: "SEARCH_HELP", text: "Search Help"  },
                        { key: "CHECKBOX",    text: "Checkbox"     },
                        { key: "DATEPICKER",  text: "Date Picker"  }
                    ];
                    var oFallbackMap = {
                        FREE_INPUT  : "Free Input",
                        DROPDOWN    : "Dropdown",
                        SEARCH_HELP : "Search Help",
                        CHECKBOX    : "Checkbox",
                        DATEPICKER  : "Date Picker"
                    };
                    oFiltersModel.setProperty("/displayTypes", aFallback);
                    oFiltersModel.setProperty("/displayTypeMap", oFallbackMap);
                });
        },

        // ── Filters ──────────────────────────────────────────────────────
        onFilterLiveChange: function () { this._applyFilters(); },
        // ── Formatters: active status ────────────────────────────────
        // Data may deliver 'active' as: "Yes"/"No", true/false, 1/0,
        // or "true"/"false". Normalise all of them.
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

        onFilterChange    : function () { this._applyFilters();},
        onGo              : function () { this._applyFilters(); },

_applyFilters: function () {
    var sSearch    = this.byId("filterSearch").getValue();
    var sMDT       = this.byId("filterMasterDataType").getSelectedKey();
    var sMainGroup = this.byId("filterMainGroup").getSelectedKey();
    var sDispType  = this.byId("filterDisplayType").getSelectedKey();
    var sActive    = this.byId("filterActive").getSelectedKey();

    var aFilters = [];

    if (sSearch) {
        aFilters.push(new Filter({
            filters: [
                new Filter("field_id",    FilterOperator.Contains, sSearch),
                new Filter("description", FilterOperator.Contains, sSearch)
            ],
            and: false
        }));
    }

    // ✅ navigate through main_group (FieldGroups) to reach master_data_type FK
    if (sMDT) {
        aFilters.push(new Filter("main_group/master_data_type_master_data_type_id", FilterOperator.EQ, sMDT));
    }

    // ✅ direct FK property on FieldMasters — confirmed in $metadata
    if (sMainGroup) {
        aFilters.push(new Filter("main_group_group_id", FilterOperator.EQ, sMainGroup));
    }

    // ✅ direct property on FieldMasters
    if (sDispType) {
        aFilters.push(new Filter("display_type", FilterOperator.EQ, sDispType));
    }

    // ✅ direct property on FieldMasters
    if (sActive !== "") {
        aFilters.push(new Filter("active", FilterOperator.EQ, sActive === "true"));
    }

    var oBinding = this.byId("fieldTable").getBinding("items");
    if (!oBinding) { return; }

    oBinding.filter(
        aFilters.length ? [new Filter({ filters: aFilters, and: true })] : []
    );
    oBinding.attachEventOnce("dataReceived", this._updateCount, this);
},
        onClearFilters: function () {
            this.byId("filterSearch").setValue("");
            this.byId("filterMasterDataType").setSelectedKey("");
            this.byId("filterMainGroup").setSelectedKey("");
            this.byId("filterDisplayType").setSelectedKey("");
            this.byId("filterActive").setSelectedKey("");
            var oBinding = this.byId("fieldTable").getBinding("items");
            if (oBinding) {
                oBinding.filter([]);
                oBinding.attachEventOnce("dataReceived", this._updateCount, this);
            }
        },

        // ── Selection ────────────────────────────────────────────────────
        onSelectionChange: function () {
            var bHasSelect = this.byId("fieldTable").getSelectedItems().length > 0;
            this.byId("bulkDeleteBtn").setVisible(bHasSelect);
            this.byId("bulkActivateBtn").setVisible(bHasSelect);
            this.byId("bulkSeparator").setVisible(bHasSelect);
        },

        // ── Bulk operations ──────────────────────────────────────────────
        onBulkDelete: function () {
            var aSelected = this.byId("fieldTable").getSelectedItems();
            if (!aSelected.length) { MessageBox.warning("Please select at least one field."); return; }
            MessageBox.confirm("Delete " + aSelected.length + " field(s)? This cannot be undone.", {
                title   : "Confirm Deletion",
                onClose : function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        this._deleteFields(aSelected);
                    }
                }.bind(this)
            });
        },

        _deleteFields: function (aItems) {
            var oModel = this.getOwnerComponent().getModel();
            var aPromises = aItems.map(function (oItem) {
                return oItem.getBindingContext().delete("$auto");
            });
            Promise.all(aPromises)
                .then(function () { MessageToast.show("Deleted successfully."); })
                .catch(function (oErr) { MessageBox.error("Delete failed: " + oErr.message); });
        },

        onBulkActivate: function () {
            var aSelected = this.byId("fieldTable").getSelectedItems();
            if (!aSelected.length) { MessageBox.warning("Please select at least one field."); return; }
            MessageBox.confirm("Activate " + aSelected.length + " field(s)?", {
                title   : "Confirm Activation",
                onClose : function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        this._activateFields(aSelected);
                    }
                }.bind(this)
            });
        },

        _activateFields: function (aItems) {
            // OData v4: patch each context individually — no callFunction
            var oModel = this.getOwnerComponent().getModel();
            var aPromises = aItems.map(function (oItem) {
                var oCtx = oItem.getBindingContext();
                return oCtx.setProperty("active", true);
            });
            Promise.all(aPromises)
                .then(function () {
                    return oModel.submitBatch("$auto");
                })
                .then(function () { MessageToast.show("Activated successfully."); })
                .catch(function (oErr) { MessageBox.error("Activation failed: " + oErr.message); });
        },

        onColumnSettings: function () {
            MessageToast.show("Column personalisation — coming soon!");
        },

        // ── Navigation ───────────────────────────────────────────────────
        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("fieldMaster");
        },

        onFieldLinkPress: function (oEvent) {
            // NOTE: sap.ui.base.Event has no stopPropagation(); that is a DOM
            // method. The row's own press fires separately and navigates to the
            // same place, so no propagation control is needed here.
            var oSrc = oEvent.getSource();
            var oCtx = oSrc.getBindingContext();
            if (!oCtx) {
                var oParent = oSrc.getParent();
                while (oParent && !oCtx) {
                    oCtx = oParent.getBindingContext && oParent.getBindingContext();
                    oParent = oParent.getParent && oParent.getParent();
                }
            }
            if (!oCtx) { return; }
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", {
                fieldId: encodeURIComponent(oCtx.getProperty("field_id"))
            });
        },

        onRowPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext();
            if (!oCtx) { return; }
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", {
                fieldId: encodeURIComponent(oCtx.getProperty("field_id"))
            });
        },

        onRowMenuPress: function (oEvent) {
            var oButton = oEvent.getSource();
            if (!this._oActionSheet) {
                this._oActionSheet = new ActionSheet({
                    buttons: [
                        new Button({ text: "Edit",       icon: "sap-icon://edit",    press: function () { MessageToast.show("Edit"); } }),
                        new Button({ text: "Duplicate",  icon: "sap-icon://copy",    press: function () { MessageToast.show("Duplicate"); } }),
                        new Button({ text: "Deactivate", icon: "sap-icon://decline", press: function () { MessageToast.show("Deactivate"); } })
                    ]
                });
                this.getView().addDependent(this._oActionSheet);
            }
            this._oActionSheet.openBy(oButton);
        },

        onAdd: function () {
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", { fieldId: "NEW" });
        },

        // ── Export ───────────────────────────────────────────────────────
        // FIX: v4 getContexts() is synchronous — it returns a plain array,
        // NOT a Promise. Calling .then() on an array throws immediately.
        // Use requestContexts() which returns a genuine Promise.
        onExport: function () {
            var oBinding = this.byId("fieldTable").getBinding("items");
            if (!oBinding) { return; }

            var iLength = oBinding.getLength();
            oBinding.requestContexts(0, iLength)
                .then(function (aContexts) {
                    var aData = aContexts.map(function (oCtx) {
                        return {
                            "Field ID"    : oCtx.getProperty("field_id"),
                            "Description" : oCtx.getProperty("description"),
                            "Data Type"   : oCtx.getProperty("data_type"),
                            "Main Group"  : oCtx.getProperty("main_group/description"),
                            "Sub Group"   : oCtx.getProperty("sub_group/description"),
                            "Length"      : oCtx.getProperty("length") || "",
                            "Display Type": oCtx.getProperty("display_type"),
                            "Active"      : oCtx.getProperty("active") ? "Yes" : "No"
                        };
                    });
                    this._downloadCSV(aData, "field-master.csv");
                }.bind(this))
                .catch(function (oErr) {
                    MessageBox.error("Export failed: " + oErr.message);
                });
        },

        _downloadCSV: function (aData, sFilename) {
            if (!aData || !aData.length) { MessageToast.show("No data to export."); return; }
            var aKeys = Object.keys(aData[0]);
            var sCSV  = aKeys.join(",") + "\n" +
                aData.map(function (oRow) {
                    return aKeys.map(function (sKey) {
                        var sVal = String(oRow[sKey] !== undefined ? oRow[sKey] : "");
                        return '"' + sVal.replace(/"/g, '""') + '"';
                    }).join(",");
                }).join("\n");

            var oBlob = new Blob([sCSV], { type: "text/csv;charset=utf-8;" });
            var sUrl  = URL.createObjectURL(oBlob);
            var oLink = document.createElement("a");
            oLink.href     = sUrl;
            oLink.download = sFilename;
            oLink.click();
            URL.revokeObjectURL(sUrl);
        },

        // FIX: validateField used oModel.callFunction() which is OData v2 only.
        // In OData v4, bound/unbound actions are called via bindContext.
        // Adjust the action path to match your CAP service definition.
        validateField: function (sFieldId, sValue) {
            var oModel  = this.getOwnerComponent().getModel();
            // Unbound action: POST /ValidateField
            var oCtx = oModel.bindContext("/ValidateField(...)");
            oCtx.setParameter("field_id", sFieldId);
            oCtx.setParameter("value",    sValue);
            oCtx.execute()
                .then(function () {
                    var oResult = oCtx.getBoundContext().getObject();
                    if (oResult.isValid) {
                        MessageToast.show("✓ Validation passed");
                    } else {
                        MessageBox.warning(oResult.errorMessage || "Validation failed");
                    }
                })
                .catch(function (oErr) {
                    MessageBox.error("Validation error: " + oErr.message);
                });
        },

        onImport: function () {
            MessageToast.show("Import — coming soon!");
        }
    });
});