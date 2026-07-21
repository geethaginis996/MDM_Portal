sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/Select",
    "sap/ui/core/Item",
    "sap/ui/layout/form/SimpleForm"
], function (
    Controller, JSONModel, Filter, FilterOperator,
    MessageToast, MessageBox, Dialog, Button, Input, Label, Select, Item, SimpleForm
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ReleaseCriteriaDetail", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oViewModel = new JSONModel({
                busy       : false,
                isNew      : false,
                isDirty    : false,
                selectedTab: "general",
                valueCount : "0",
                usageCount : "0"
            });
            this.getView().setModel(this._oViewModel, "view");
            this.getView().setModel(new JSONModel({ items: [] }), "usage");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("releaseCriteriaDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Route matched ────────────────────────────────────────────
        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            var sRaw  = decodeURIComponent(oArgs.criteriaId);
            var sId   = (sRaw === "NEW") ? sRaw : sRaw.toUpperCase();
            var sMdt  = (sRaw === "NEW") ? "NEW" : decodeURIComponent(oArgs.appliesTo);

            try { this.getOwnerComponent().getModel().resetChanges("releaseCriteriaUpdate"); } catch (e) { /* no pending */ }
            try { this.getOwnerComponent().getModel().resetChanges("releaseCriteriaValuesUpdate"); } catch (e) { /* no pending */ }

            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this._oViewModel.setProperty("/valueCount", "0");
            this._oViewModel.setProperty("/usageCount", "0");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("usage").setProperty("/items", []);

            if (sId === "NEW") {
                this._createNew();
            } else {
                this._bindCriteria(sId, sMdt);
            }
        },

        // ── Bind existing ────────────────────────────────────────────
        _bindCriteria: function (sId, sMdt) {
            this._oViewModel.setProperty("/isNew", false);
            this._oViewModel.setProperty("/busy",  true);

            // StrategyCharacteristic has a composite key (characteristic_id +
            // master_data_type) — both parts are required to address a
            // single record via OData. Values like "BUSINESS PARTNER" contain
            // a space, which MUST be percent-encoded here: this path gets
            // embedded as a raw "GET <path> HTTP/1.1" request-line inside the
            // $batch body, and an unescaped space breaks HTTP request-line
            // parsing (HPE_INVALID_CONSTANT), even though the same value
            // would be fine in an ordinary standalone request.
            var sPath = "/StrategyCharacteristics(characteristic_id='" + encodeURIComponent(sId) +
                        "',master_data_type_master_data_type_id='" + encodeURIComponent(sMdt) + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: {
                    $select: "characteristic_id,description,data_type,active," +
                             "master_data_type_master_data_type_id,field_field_id",
                    $$updateGroupId: "releaseCriteriaUpdate"
                },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);

                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load release criteria: " + (oError.message || "Unknown error"));
                            return;
                        }
                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Release criteria not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (!oData) { return; }
                            this._refreshHeader(oData);

                            var oSelApplies = this.byId("selAppliesTo");
                            if (oSelApplies) { oSelApplies.setSelectedKey(oData.master_data_type_master_data_type_id); }

                            var oSelField = this.byId("selField");
                            if (oSelField) { oSelField.setSelectedKey(oData.field_field_id); }

                            var oSelDataType = this.byId("selDataType");
                            if (oSelDataType) { oSelDataType.setSelectedKey(oData.data_type); }

                            // Load tab badge data eagerly, right when the record loads
                            // — not lazily on tab-select — so both tab counts are
                            // correct immediately, regardless of which tab is active.
                            this._loadValues();
                            this._loadUsage();
                        }.bind(this));

                        this.byId("inId").setEditable(false);
                    }.bind(this)
                }
            });
        },

        // ── Create new ───────────────────────────────────────────────
        _createNew: function () {
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/busy",  true);

            this.getView().unbindObject();

            this._generateNextCriteriaId().then(function (sNextId) {
                var oView = this.getView();
                if (!oView || oView.bIsDestroyed) { return; }

                var oModel = this.getOwnerComponent().getModel();
                var oListBinding = oModel.bindList("/StrategyCharacteristics", null, [], [], {
                    $$updateGroupId: "releaseCriteriaUpdate"
                });
                var oContext = oListBinding.create({
                    characteristic_id: sNextId,
                    description       : "",
                    data_type         : "STRING",
                    active            : true,
                    master_data_type_master_data_type_id: null,
                    field_field_id    : null
                });
                this._oCreateListBinding = oListBinding;
                this.getView().setBindingContext(oContext);
                this._refreshHeader({ characteristic_id: sNextId, description: "", active: true });

                this.byId("selAppliesTo").setSelectedKey("");
                this.byId("selField").setSelectedKey("");
                this.byId("selDataType").setSelectedKey("STRING");
                this._oViewModel.setProperty("/busy", false);
            }.bind(this));
        },

        // Finds the highest existing "RC###" id and returns the next one
        // (e.g. RC007 in use → returns "RC008"). Falls back to RC001 if
        // none exist yet, or if anything goes wrong reading existing ones.
        _generateNextCriteriaId: function () {
            var oModel = this.getOwnerComponent().getModel();
            return oModel.bindList("/StrategyCharacteristics", null, null, null, {
                $select: "characteristic_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var iMax = 0;
                aCtx.forEach(function (c) {
                    var sId = c.getProperty("characteristic_id") || "";
                    var oMatch = /^RC(\d+)$/.exec(sId);
                    if (oMatch) { iMax = Math.max(iMax, parseInt(oMatch[1], 10)); }
                });
                var iNext = iMax + 1;
                return "RC" + String(iNext).padStart(3, "0");
            }).catch(function () {
                return "RC001";
            });
        },

        // ── Header refresh ───────────────────────────────────────────
        _refreshHeader: function (oData) {
            var oView = this.getView();
            if (!oView || oView.bIsDestroyed) { return; }

            var sId    = oData.characteristic_id || "";
            var sDesc  = oData.description || "";
            var sTitle = sId ? (sId + (sDesc ? " — " + sDesc : "")) : "New Release Criteria";

            var oTitle = this.byId("pageTitle");
            if (oTitle) { oTitle.setText(sTitle); }

            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) { oBreadcrumb.setCurrentLocationText(sId || "New Release Criteria"); }

            var oStatus = this.byId("attrStatus");
            if (oStatus) { oStatus.setText(oData.active === false ? "Inactive" : "Active"); }

            var oCreated = this.byId("attrCreated");
            if (oCreated) { oCreated.setText(oData.createdBy || "\u2014"); }

            var oDate = this.byId("attrDate");
            if (oDate) {
                oDate.setText(oData.createdAt ? new Date(oData.createdAt).toLocaleDateString() : "\u2014");
            }
        },

        // ── Dirty flag ───────────────────────────────────────────────
        onFieldChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
        },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            // Data is already loaded eagerly on bind; re-fetch on tab-select too
            // so the tab reflects any change made elsewhere in the same session.
            if (sKey === "values")    { this._loadValues(); }
            if (sKey === "usage")     { this._loadUsage(); }
            if (sKey === "changelog") { this._loadChangeLog(); }
        },

        // ── Change Log tab ───────────────────────────────────────────
        _loadChangeLog: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId  = oCtx.getProperty("characteristic_id");
            var sMdt = oCtx.getProperty("master_data_type_master_data_type_id");
            if (!sId) { return; }

            var oVm = this._oViewModel;
            oVm.setProperty("/clCreatedAt",  this._fmtDate(oCtx.getProperty("createdAt")));
            oVm.setProperty("/clCreatedBy",  oCtx.getProperty("createdBy")  || "\u2014");
            oVm.setProperty("/clModifiedAt", this._fmtDate(oCtx.getProperty("modifiedAt")));
            oVm.setProperty("/clModifiedBy", oCtx.getProperty("modifiedBy") || "\u2014");

            // Matches the backend's composite entity_key format exactly:
            // id + "::" + master_data_type (see mdm-service.js auditBuildKey).
            var sEntityKey = sId + "::" + sMdt;

            var oTable   = this.byId("logTable");
            var oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter([
                new Filter("entity_name", FilterOperator.EQ, "StrategyCharacteristic"),
                new Filter("entity_key",  FilterOperator.EQ, sEntityKey)
            ]);
            oBinding.resume();
        },

        _fmtDate: function (sVal) {
            if (!sVal) { return "\u2014"; }
            try { return new Date(sVal).toLocaleString(); } catch (e) { return sVal; }
        },

        // ── Allowed Values tab ───────────────────────────────────────
        _loadValues: function () {
            var oTable = this.byId("valuesTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }

            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iCount) {
                    var oView = this.getView();
                    if (!oView || oView.bIsDestroyed) { return; }
                    this._oViewModel.setProperty("/valueCount", String(iCount || 0));
                }.bind(this)).catch(function () {
                    // New/unsaved record has no nav path yet — leave empty, no error.
                });
            }
        },

        onAddValue: function () {
            if (this._oViewModel.getProperty("/isNew")) {
                MessageToast.show("Save the criteria first before adding allowed values.");
                return;
            }
            this._openValueDialog(null);
        },

        onValueRowPress: function (oEvent) {
            this._openValueDialog(oEvent.getSource().getBindingContext());
        },

        // oExistingCtx: null → "Add" mode (create a new row).
        //               a row's live context → "Edit" mode (update that row).
        _openValueDialog: function (oExistingCtx) {
            var bEdit = !!oExistingCtx;

            if (!this._oValueDialog) {
                var oTypeSelect = new Select({
                    selectedKey: "EQ",
                    items: [
                        new Item({ key: "EQ",      text: "Single Value" }),
                        new Item({ key: "BETWEEN", text: "Range" })
                    ],
                    change: function () {
                        var bRange = oTypeSelect.getSelectedKey() === "BETWEEN";
                        oValueLabel.setText(bRange ? "From" : "Value");
                        oToLabel.setVisible(bRange);
                        oToInput.setVisible(bRange);
                    }
                });
                var oValueLabel = new Label({ text: "Value", required: true });
                var oValueInput = new Input({ placeholder: "e.g. 1000", maxLength: 200 });
                var oToLabel     = new Label({ text: "To", required: true, visible: false });
                var oToInput     = new Input({ placeholder: "e.g. 4999", maxLength: 200, visible: false });
                var oDescInput   = new Input({ placeholder: "e.g. Domestic Customer", maxLength: 100 });

                var fnReset = function () {
                    oTypeSelect.setSelectedKey("EQ");
                    oValueLabel.setText("Value");
                    oToLabel.setVisible(false);
                    oToInput.setVisible(false);
                    oValueInput.setValue("");
                    oToInput.setValue("");
                    oDescInput.setValue("");
                };

                this._oValueDialog = new Dialog({
                    title  : "Add Allowed Value",
                    content: new SimpleForm({
                        editable: true,
                        layout  : "ResponsiveGridLayout",
                        content : [
                            new Label({ text: "Type", required: true }), oTypeSelect,
                            oValueLabel, oValueInput,
                            oToLabel, oToInput,
                            new Label({ text: "Description", required: true }), oDescInput
                        ]
                    }),
                    beginButton: new Button({
                        text: "Add",
                        type: "Emphasized",
                        press: function () {
                            var sOperator = oTypeSelect.getSelectedKey();
                            var sFrom     = oValueInput.getValue().trim();
                            var sTo       = oToInput.getValue().trim();
                            var sDesc     = oDescInput.getValue().trim();
                            var oCtxBeingEdited = this._oValueDialog._oEditingCtx;

                            if (!sFrom || !sDesc || (sOperator === "BETWEEN" && !sTo)) {
                                MessageBox.error(
                                    sOperator === "BETWEEN"
                                        ? "From, To, and Description are all required for a range."
                                        : "Both Value and Description are required."
                                );
                                return;
                            }
                            if (sOperator === "BETWEEN" && sFrom === sTo) {
                                MessageBox.error("From and To cannot be the same value \u2014 use \"Single Value\" instead.");
                                return;
                            }

                            // Unlike the previous design (where value_key was
                            // itself the primary key), "counter" is just a
                            // row number now, so the database no longer
                            // prevents two rows describing the same value or
                            // the exact same range. Check explicitly here —
                            // excluding the row currently being edited from
                            // the comparison, since it's allowed to keep its
                            // own value_from/value_to (or change to a
                            // genuinely different one).
                            var iEditingCounter = oCtxBeingEdited ? oCtxBeingEdited.getProperty("counter") : null;
                            var aExistingRows = this._getLoadedValueRows().filter(function (o) {
                                return o.counter !== iEditingCounter;
                            });
                            var bDuplicate = aExistingRows.some(function (o) {
                                if (o.operator !== sOperator) { return false; }
                                if (sOperator === "EQ") { return o.value_from === sFrom; }
                                return o.value_from === sFrom && o.value_to === sTo;
                            });
                            if (bDuplicate) {
                                MessageBox.error(
                                    sOperator === "BETWEEN"
                                        ? "The range " + sFrom + " \u2013 " + sTo + " is already defined for this characteristic."
                                        : "Value \"" + sFrom + "\" is already defined for this characteristic."
                                );
                                return;
                            }

                            var sValueTo = sOperator === "BETWEEN" ? sTo : "";
                            if (oCtxBeingEdited) {
                                this._updateValue(oCtxBeingEdited, sOperator, sFrom, sValueTo, sDesc);
                            } else {
                                this._createValue(sOperator, sFrom, sValueTo, sDesc);
                            }

                            fnReset();
                            this._oValueDialog.close();
                        }.bind(this)
                    }),
                    endButton: new Button({
                        text: "Cancel",
                        press: function () { this._oValueDialog.close(); }.bind(this)
                    }),
                    afterClose: fnReset
                });
                this._oValueDialog._oTypeSelect = oTypeSelect;
                this._oValueDialog._oValueLabel = oValueLabel;
                this._oValueDialog._oValueInput = oValueInput;
                this._oValueDialog._oToLabel    = oToLabel;
                this._oValueDialog._oToInput    = oToInput;
                this._oValueDialog._oDescInput  = oDescInput;
                this.getView().addDependent(this._oValueDialog);
            }

            // Configure for Add vs Edit mode
            this._oValueDialog._oEditingCtx = oExistingCtx;
            var oTypeSelect = this._oValueDialog._oTypeSelect;
            var oValueLabel = this._oValueDialog._oValueLabel;
            var oValueInput = this._oValueDialog._oValueInput;
            var oToLabel    = this._oValueDialog._oToLabel;
            var oToInput    = this._oValueDialog._oToInput;
            var oDescInput  = this._oValueDialog._oDescInput;

            if (bEdit) {
                var sOperator = oExistingCtx.getProperty("operator");
                var bRange    = sOperator === "BETWEEN";
                this._oValueDialog.setTitle("Edit Allowed Value");
                this._oValueDialog.getBeginButton().setText("Save");
                oTypeSelect.setSelectedKey(sOperator);
                oValueLabel.setText(bRange ? "From" : "Value");
                oToLabel.setVisible(bRange);
                oToInput.setVisible(bRange);
                oValueInput.setValue(oExistingCtx.getProperty("value_from"));
                oToInput.setValue(oExistingCtx.getProperty("value_to") || "");
                oDescInput.setValue(oExistingCtx.getProperty("description"));
            } else {
                this._oValueDialog.setTitle("Add Allowed Value");
                this._oValueDialog.getBeginButton().setText("Add");
                oTypeSelect.setSelectedKey("EQ");
                oValueLabel.setText("Value");
                oToLabel.setVisible(false);
                oToInput.setVisible(false);
                oValueInput.setValue("");
                oToInput.setValue("");
                oDescInput.setValue("");
            }

            this._oValueDialog.open();
        },

        _updateValue: function (oCtx, sOperator, sFrom, sTo, sDesc) {
            oCtx.setProperty("operator", sOperator);
            oCtx.setProperty("value_from", sFrom);
            oCtx.setProperty("value_to", sTo);
            oCtx.setProperty("description", sDesc);

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseCriteriaValuesUpdate")
                .then(function () {
                    MessageToast.show("Value updated.");
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not update value: " + (e.message || "Unknown error"));
                });
        },

        _getLoadedValueRows: function () {
            var oTable = this.byId("valuesTable");
            if (!oTable) { return []; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return []; }
            return oBinding.getAllCurrentContexts().map(function (c) { return c.getObject(); });
        },

        _createValue: function (sOperator, sFrom, sTo, sDesc) {
            var oTable = this.byId("valuesTable");
            if (!oTable) { return; }
            var oListBinding = oTable.getBinding("items");
            if (!oListBinding) { return; }

            // counter is the row's own key (alongside the inherited parent
            // FK) — since a range doesn't have a natural single "key" value,
            // each row is just numbered. Next counter = current max + 1.
            var aExisting  = this._getLoadedValueRows();
            var iNextCounter = aExisting.reduce(function (iMax, o) {
                return Math.max(iMax, o.counter || 0);
            }, 0) + 1;

            // Create through the table's own LIVE binding (not a freshly
            // manufactured, orphaned bindList) — this is what makes the new
            // row properly tracked by the model and immediately visible,
            // and is the same reason deletes now work reliably too (see
            // onDeleteValue).
            oListBinding.create({
                counter    : iNextCounter,
                operator   : sOperator,
                value_from : sFrom,
                value_to   : sTo,
                description: sDesc
            });

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseCriteriaValuesUpdate")
                .then(function () {
                    MessageToast.show("Value added.");
                    this._loadValues();
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not add value: " + (e.message || "Unknown error"));
                });
        },

        onDeleteValue: function (oEvent) {
            // The row's OWN context, from the table's live OData binding —
            // NOT a freshly manufactured bindContext(). A standalone context
            // built via bindContext().getBoundContext() is never attached to
            // anything the model considers "live", and .delete() on it can
            // resolve successfully without ever sending a real request. The
            // row's real context, as used by the table itself, is what
            // actually performs and tracks the delete correctly.
            var oRowCtx  = oEvent.getSource().getBindingContext();
            var sDisplay = oRowCtx.getProperty("operator") === "BETWEEN"
                ? oRowCtx.getProperty("value_from") + " \u2013 " + oRowCtx.getProperty("value_to")
                : oRowCtx.getProperty("value_from");

            MessageBox.confirm("Delete allowed value \"" + sDisplay + "\"?", {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }

                    oRowCtx.delete("$auto")
                        .then(function () {
                            MessageToast.show("Value deleted.");
                            this._loadValues();
                        }.bind(this))
                        .catch(function (e) {
                            MessageBox.error("Delete failed: " + (e.message || "Unknown error"));
                        }.bind(this));
                }.bind(this)
            });
        },

        // ── Used By Strategies tab ───────────────────────────────────
        _loadUsage: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId  = oCtx.getProperty("characteristic_id");
            var sMdt = oCtx.getProperty("master_data_type_master_data_type_id");
            if (!sId) { return; }

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/ReleaseStrategyValues", null, null, [
                new Filter({
                    filters: [
                        new Filter("characteristic_characteristic_id", FilterOperator.EQ, sId),
                        new Filter("characteristic_master_data_type_master_data_type_id", FilterOperator.EQ, sMdt)
                    ],
                    and: true
                })
            ], {
                $expand: "strategy($select=strategy_id,description,master_data_type_master_data_type_id,active)"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var oView = this.getView();
                if (!oView || oView.bIsDestroyed) { return; }

                var aItems = aCtx.map(function (c) {
                    var oStrategy = c.getObject().strategy || {};
                    return {
                        strategy_id      : oStrategy.strategy_id,
                        description      : oStrategy.description,
                        master_data_type : oStrategy.master_data_type_master_data_type_id,
                        active           : oStrategy.active
                    };
                }).filter(function (o) { return !!o.strategy_id; });

                oView.getModel("usage").setProperty("/items", aItems);
                this._oViewModel.setProperty("/usageCount", String(aItems.length));
            }.bind(this)).catch(function () {
                // New/unsaved record or no matches yet — leave empty, no error.
            });
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            // Criteria ID is auto-generated (see _generateNextCriteriaId)
            // and the field is always read-only, so it's never something
            // the user could mistype — just read it back.
            var sId         = this.byId("inId").getValue().trim();
            var sDesc       = this.byId("inDescription").getValue().trim();
            var sAppliesTo  = this.byId("selAppliesTo").getSelectedKey();
            var sField      = this.byId("selField").getSelectedKey();
            var sDataType   = this.byId("selDataType").getSelectedKey();

            if (!sId) {
                MessageBox.error("Criteria ID could not be generated. Please cancel and try again.");
                return;
            }
            if (!sDesc)      { MessageBox.error("Description is required."); return; }
            if (!sAppliesTo) { MessageBox.error("Applies To is required."); return; }
            if (!sField)     { MessageBox.error("Source Field is required."); return; }
            if (!sDataType)  { MessageBox.error("Data Type is required."); return; }

            this._oViewModel.setProperty("/busy", true);

            var bIsNew = this._oViewModel.getProperty("/isNew");
            var oCtx   = this.getView().getBindingContext();

            if (oCtx) {
                if (bIsNew) { oCtx.setProperty("characteristic_id", sId); }
                oCtx.setProperty("master_data_type_master_data_type_id", sAppliesTo);
                oCtx.setProperty("field_field_id", sField);
                oCtx.setProperty("data_type", sDataType);
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseCriteriaUpdate")
                .then(function () {
                    if (bIsNew && oCtx && oCtx.created) {
                        return oCtx.created().then(function () { return true; });
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Release criteria saved successfully.");

                    if (bWasCreated) {
                        this._oCreateListBinding = null;
                        setTimeout(this.onNavBack.bind(this), 300);
                    } else if (oCtx) {
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                        }.bind(this));
                    }
                }.bind(this))
                .catch(function (oErr) {
                    this._oViewModel.setProperty("/busy", false);
                    var sMsg = oErr && oErr.message ? oErr.message : "Unknown error";
                    MessageBox.error("Save failed: " + sMsg);
                }.bind(this));
        },

        // ── Cancel ───────────────────────────────────────────────────
        onCancel: function () {
            var fnGoBack = function () {
                this.getOwnerComponent().getModel().resetChanges("releaseCriteriaUpdate");
                try { this.getOwnerComponent().getModel().resetChanges("releaseCriteriaValuesUpdate"); } catch (e) { /* no pending */ }
                this._oViewModel.setProperty("/isDirty", false);
                this.onNavBack();
            }.bind(this);

            if (this._oViewModel.getProperty("/isDirty")) {
                MessageBox.confirm("Discard unsaved changes?", {
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) { fnGoBack(); }
                    }
                });
            } else {
                fnGoBack();
            }
        },

        // ── Navigation ───────────────────────────────────────────────
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("releaseCriteria");
        }
    });
});
