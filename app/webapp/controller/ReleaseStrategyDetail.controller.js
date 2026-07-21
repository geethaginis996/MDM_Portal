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
    "sap/m/Switch",
    "sap/m/Text",
    "sap/m/Title",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Avatar",
    "sap/ui/core/Icon",
    "sap/ui/core/Item",
    "sap/ui/layout/form/SimpleForm"
], function (
    Controller, JSONModel, Filter, FilterOperator,
    MessageToast, MessageBox, Dialog, Button, Input, Label, Select, Switch,
    Text, Title, VBox, HBox, Avatar, Icon, Item, SimpleForm
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ReleaseStrategyDetail", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oViewModel = new JSONModel({
                busy       : false,
                isNew      : false,
                isDirty    : false,
                selectedTab: "general",
                valueCount : "0",
                stepCount  : "0"
            });
            this.getView().setModel(this._oViewModel, "view");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("releaseStrategyDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Route matched ────────────────────────────────────────────
        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            var sRaw  = decodeURIComponent(oArgs.strategyId);
            var sId   = (sRaw === "NEW") ? sRaw : sRaw.toUpperCase();
            var sMdt  = (sRaw === "NEW") ? "NEW" : decodeURIComponent(oArgs.appliesTo);

            try { this.getOwnerComponent().getModel().resetChanges("releaseStrategyUpdate"); } catch (e) { /* no pending */ }
            try { this.getOwnerComponent().getModel().resetChanges("releaseStrategyValuesUpdate"); } catch (e) { /* no pending */ }
            try { this.getOwnerComponent().getModel().resetChanges("releaseStrategyStepsUpdate"); } catch (e) { /* no pending */ }

            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this._oViewModel.setProperty("/valueCount", "0");
            this._oViewModel.setProperty("/stepCount", "0");
            this.byId("detailTabs").setSelectedKey("general");

            if (sId === "NEW") {
                this._createNew();
            } else {
                this._bindStrategy(sId, sMdt);
            }
        },

        // ── Bind existing ────────────────────────────────────────────
        _bindStrategy: function (sId, sMdt) {
            this._oViewModel.setProperty("/isNew", false);
            this._oViewModel.setProperty("/busy",  true);

            // ReleaseStrategy has a composite key (strategy_id +
            // master_data_type) — both parts are required to address a
            // single record via OData, and both must be percent-encoded
            // since master_data_type values like "BUSINESS PARTNER"
            // contain a space, which breaks raw HTTP request-line parsing
            // inside $batch bodies if left unescaped.
            var sPath = "/ReleaseStrategies(strategy_id='" + encodeURIComponent(sId) +
                        "',master_data_type_master_data_type_id='" + encodeURIComponent(sMdt) + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: {
                    $select: "strategy_id,description,priority,active,valid_from,valid_to," +
                             "master_data_type_master_data_type_id",
                    $$updateGroupId: "releaseStrategyUpdate"
                },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);

                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load release strategy: " + (oError.message || "Unknown error"));
                            return;
                        }
                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Release strategy not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (!oData) { return; }
                            this._refreshHeader(oData);

                            var oSelApplies = this.byId("selAppliesTo");
                            if (oSelApplies) { oSelApplies.setSelectedKey(oData.master_data_type_master_data_type_id); }

                            // Load tab badge data eagerly, right when the record loads
                            // — not lazily on tab-select — so both tab counts are
                            // correct immediately, regardless of which tab is active.
                            this._loadValueCount();
                            this._loadStepCount();
                            this._attachStepsTableRefresh();
                        }.bind(this));
                    }.bind(this)
                }
            });
        },

        // ── Create new ───────────────────────────────────────────────
        _createNew: function () {
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/busy",  true);

            this.getView().unbindObject();

            this._generateNextStrategyId().then(function (sNextId) {
                var oView = this.getView();
                if (!oView || oView.bIsDestroyed) { return; }

                var oModel = this.getOwnerComponent().getModel();
                var oListBinding = oModel.bindList("/ReleaseStrategies", null, [], [], {
                    $$updateGroupId: "releaseStrategyUpdate"
                });
                var oContext = oListBinding.create({
                    strategy_id: sNextId,
                    description: "",
                    priority   : 10,
                    active     : true,
                    valid_from : new Date().toISOString().slice(0, 10),
                    valid_to   : null,
                    master_data_type_master_data_type_id: null
                });
                this._oCreateListBinding = oListBinding;
                this.getView().setBindingContext(oContext);
                this._refreshHeader({ strategy_id: sNextId, description: "", active: true, priority: 10 });

                this.byId("selAppliesTo").setSelectedKey("");
                this._oViewModel.setProperty("/busy", false);
            }.bind(this));
        },

        // Finds the highest existing "RS###" id and returns the next one.
        // Falls back to RS001 if none exist yet or on error.
        _generateNextStrategyId: function () {
            var oModel = this.getOwnerComponent().getModel();
            return oModel.bindList("/ReleaseStrategies", null, null, null, {
                $select: "strategy_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var iMax = 0;
                aCtx.forEach(function (c) {
                    var sId = c.getProperty("strategy_id") || "";
                    var oMatch = /^RS(\d+)$/.exec(sId);
                    if (oMatch) { iMax = Math.max(iMax, parseInt(oMatch[1], 10)); }
                });
                return "RS" + String(iMax + 1).padStart(3, "0");
            }).catch(function () {
                return "RS001";
            });
        },

        // ── Header refresh ───────────────────────────────────────────
        _refreshHeader: function (oData) {
            var oView = this.getView();
            if (!oView || oView.bIsDestroyed) { return; }

            var sId    = oData.strategy_id || "";
            var sDesc  = oData.description || "";
            var sTitle = sId ? (sId + (sDesc ? " — " + sDesc : "")) : "New Release Strategy";
            var bActive = oData.active !== false;

            var oTitle = this.byId("pageTitle");
            if (oTitle) { oTitle.setText(sTitle); }

            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) { oBreadcrumb.setCurrentLocationText(sId || "New Release Strategy"); }

            var oAttrStatus = this.byId("attrStatus");
            if (oAttrStatus) {
                oAttrStatus.setText(bActive ? "Active" : "Inactive");
                oAttrStatus.setState(bActive ? "Success" : "Error");
            }
            var oAttrPriority = this.byId("attrPriority");
            if (oAttrPriority) { oAttrPriority.setText(oData.priority !== undefined ? String(oData.priority) : "\u2014"); }

            // Same lesson as Value Tables' Status switch: an expression
            // binding on state can silently fail to fetch the property in
            // time via OData V4's auto-$select detection. Set explicitly
            // from data that's already resolved here instead.
            var oSwActive = this.byId("swActive");
            if (oSwActive) { oSwActive.setState(bActive); }
        },

        // ── Dirty flag ───────────────────────────────────────────────
        onFieldChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
        },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            if (sKey === "values")    { this._loadValueCount(); }
            if (sKey === "steps")     { this._loadStepCount(); }
            if (sKey === "changelog") { this._loadChangeLog(); }
        },

        // ── Change Log tab ───────────────────────────────────────────
        _loadChangeLog: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId  = oCtx.getProperty("strategy_id");
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
                new Filter("entity_name", FilterOperator.EQ, "ReleaseStrategy"),
                new Filter("entity_key",  FilterOperator.EQ, sEntityKey)
            ]);
            oBinding.resume();
        },

        _fmtDate: function (sVal) {
            if (!sVal) { return "\u2014"; }
            try { return new Date(sVal).toLocaleString(); } catch (e) { return sVal; }
        },

        // ── Criteria Values tab ──────────────────────────────────────
        _loadValueCount: function () {
            var oTable = this.byId("criteriaValuesTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }
            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iCount) {
                    var oView = this.getView();
                    if (!oView || oView.bIsDestroyed) { return; }
                    this._oViewModel.setProperty("/valueCount", String(iCount || 0));
                }.bind(this)).catch(function () { /* new/unsaved record — leave at 0 */ });
            }
        },

        _getLoadedValueRows: function () {
            var oTable = this.byId("criteriaValuesTable");
            if (!oTable) { return []; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return []; }
            return oBinding.getAllCurrentContexts().map(function (c) { return c.getObject(); });
        },

        onAddCriteriaValue: function () {
            if (this._oViewModel.getProperty("/isNew")) {
                MessageToast.show("Save the strategy first before adding criteria values.");
                return;
            }
            this._openValueDialog(null);
        },

        onCriteriaValueRowPress: function (oEvent) {
            this._openValueDialog(oEvent.getSource().getBindingContext());
        },

        // oExistingCtx: null → "Add" mode. A row's live context → "Edit" mode.
        _openValueDialog: function (oExistingCtx) {
            var bEdit = !!oExistingCtx;

            if (!this._oValueDialog) {
                var oCriteriaSelect = new Select({ forceSelection: false });
                var oOperatorSelect = new Select({
                    selectedKey: "EQ",
                    items: [
                        new Item({ key: "EQ",      text: "Equals" }),
                        new Item({ key: "BETWEEN", text: "Range (Between)" })
                    ],
                    change: function () {
                        var bRange = oOperatorSelect.getSelectedKey() === "BETWEEN";
                        oValueLabel.setText(bRange ? "From" : "Value");
                        oToLabel.setVisible(bRange);
                        oToInput.setVisible(bRange);
                    }
                });
                var oValueLabel = new Label({ text: "Value", required: true });
                var oValueInput = new Input({ placeholder: "e.g. 1000", maxLength: 200 });
                var oToLabel     = new Label({ text: "To", required: true, visible: false });
                var oToInput     = new Input({ placeholder: "e.g. 4999", maxLength: 200, visible: false });

                var fnReset = function () {
                    oOperatorSelect.setSelectedKey("EQ");
                    oValueLabel.setText("Value");
                    oToLabel.setVisible(false);
                    oToInput.setVisible(false);
                    oValueInput.setValue("");
                    oToInput.setValue("");
                };

                this._oValueDialog = new Dialog({
                    title  : "Add Criteria Value",
                    content: new SimpleForm({
                        editable: true,
                        layout  : "ResponsiveGridLayout",
                        content : [
                            new Label({ text: "Criteria", required: true }), oCriteriaSelect,
                            new Label({ text: "Operator", required: true }), oOperatorSelect,
                            oValueLabel, oValueInput,
                            oToLabel, oToInput
                        ]
                    }),
                    beginButton: new Button({
                        text: "Add",
                        type: "Emphasized",
                        press: function () {
                            var sCriteriaId = oCriteriaSelect.getSelectedKey();
                            var sOperator   = oOperatorSelect.getSelectedKey();
                            var sFrom       = oValueInput.getValue().trim();
                            var sTo         = oToInput.getValue().trim();
                            var oCtxBeingEdited = this._oValueDialog._oEditingCtx;

                            if (!sCriteriaId) { MessageBox.error("Criteria is required."); return; }
                            if (!sFrom || (sOperator === "BETWEEN" && !sTo)) {
                                MessageBox.error(
                                    sOperator === "BETWEEN"
                                        ? "From and To are both required for a range."
                                        : "Value is required."
                                );
                                return;
                            }
                            if (sOperator === "BETWEEN" && sFrom === sTo) {
                                MessageBox.error("From and To cannot be the same value.");
                                return;
                            }

                            // Duplicate check: this strategy shouldn't have
                            // the same criteria referenced twice (excluding
                            // the row currently being edited).
                            var iEditingCounter = oCtxBeingEdited ? oCtxBeingEdited.getProperty("counter") : null;
                            var aExisting = this._getLoadedValueRows().filter(function (o) {
                                return o.counter !== iEditingCounter;
                            });
                            var bDuplicate = aExisting.some(function (o) {
                                return o.characteristic_characteristic_id === sCriteriaId;
                            });
                            if (bDuplicate) {
                                MessageBox.error("Criteria \"" + sCriteriaId + "\" is already used in this strategy.");
                                return;
                            }

                            var sValueTo = sOperator === "BETWEEN" ? sTo : "";
                            if (oCtxBeingEdited) {
                                this._updateCriteriaValue(oCtxBeingEdited, sOperator, sFrom, sValueTo);
                            } else {
                                this._createCriteriaValue(sCriteriaId, sOperator, sFrom, sValueTo);
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
                this._oValueDialog._oCriteriaSelect = oCriteriaSelect;
                this._oValueDialog._oOperatorSelect = oOperatorSelect;
                this._oValueDialog._oValueLabel     = oValueLabel;
                this._oValueDialog._oValueInput     = oValueInput;
                this._oValueDialog._oToLabel        = oToLabel;
                this._oValueDialog._oToInput        = oToInput;
                this.getView().addDependent(this._oValueDialog);
            }

            var oCriteriaSelect = this._oValueDialog._oCriteriaSelect;
            var oOperatorSelect = this._oValueDialog._oOperatorSelect;
            var oValueLabel     = this._oValueDialog._oValueLabel;
            var oValueInput     = this._oValueDialog._oValueInput;
            var oToLabel        = this._oValueDialog._oToLabel;
            var oToInput        = this._oValueDialog._oToInput;

            this._oValueDialog._oEditingCtx = oExistingCtx;

            // Populate the Criteria dropdown from StrategyCharacteristics
            // matching this strategy's own Applies To, excluding criteria
            // already used elsewhere in this strategy (unless it's the one
            // currently being edited).
            var oCtx = this.getView().getBindingContext();
            var sMdt = oCtx ? oCtx.getProperty("master_data_type_master_data_type_id") : null;
            var iEditingCounter = oExistingCtx ? oExistingCtx.getProperty("counter") : null;
            var aUsedIds = this._getLoadedValueRows()
                .filter(function (o) { return o.counter !== iEditingCounter; })
                .map(function (o) { return o.characteristic_characteristic_id; });

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/StrategyCharacteristics", null, null, sMdt ? [
                new Filter("master_data_type_master_data_type_id", FilterOperator.EQ, sMdt)
            ] : null, { $select: "characteristic_id,description" })
                .requestContexts(0, Infinity).then(function (aCtx) {
                    oCriteriaSelect.destroyItems();
                    aCtx.forEach(function (c) {
                        var sCid = c.getProperty("characteristic_id");
                        if (aUsedIds.indexOf(sCid) !== -1 && sCid !== (oExistingCtx && oExistingCtx.getProperty("characteristic_characteristic_id"))) {
                            return; // already used by another row in this strategy
                        }
                        oCriteriaSelect.addItem(new Item({
                            key : sCid,
                            text: sCid + " \u2014 " + c.getProperty("description")
                        }));
                    });

                    if (bEdit) {
                        var sOperator = oExistingCtx.getProperty("operator");
                        var bRange    = sOperator === "BETWEEN";
                        this._oValueDialog.setTitle("Edit Criteria Value");
                        this._oValueDialog.getBeginButton().setText("Save");
                        oCriteriaSelect.setSelectedKey(oExistingCtx.getProperty("characteristic_characteristic_id"));
                        oCriteriaSelect.setEnabled(false); // criteria itself isn't editable, only its condition
                        oOperatorSelect.setSelectedKey(sOperator);
                        oValueLabel.setText(bRange ? "From" : "Value");
                        oToLabel.setVisible(bRange);
                        oToInput.setVisible(bRange);
                        oValueInput.setValue(oExistingCtx.getProperty("value_from"));
                        oToInput.setValue(oExistingCtx.getProperty("value_to") || "");
                    } else {
                        this._oValueDialog.setTitle("Add Criteria Value");
                        this._oValueDialog.getBeginButton().setText("Add");
                        oCriteriaSelect.setSelectedKey("");
                        oCriteriaSelect.setEnabled(true);
                        oOperatorSelect.setSelectedKey("EQ");
                        oValueLabel.setText("Value");
                        oToLabel.setVisible(false);
                        oToInput.setVisible(false);
                        oValueInput.setValue("");
                        oToInput.setValue("");
                    }

                    this._oValueDialog.open();
                }.bind(this));
        },

        _createCriteriaValue: function (sCriteriaId, sOperator, sFrom, sTo) {
            var oTable = this.byId("criteriaValuesTable");
            if (!oTable) { return; }
            var oListBinding = oTable.getBinding("items");
            if (!oListBinding) { return; }

            var oCtx = this.getView().getBindingContext();
            var sMdt = oCtx.getProperty("master_data_type_master_data_type_id");

            var aExisting = this._getLoadedValueRows().filter(function (o) {
                return o.characteristic_characteristic_id === sCriteriaId;
            });
            var iNextCounter = aExisting.reduce(function (iMax, o) {
                return Math.max(iMax, o.counter || 0);
            }, 0) + 1;

            oListBinding.create({
                characteristic_characteristic_id: sCriteriaId,
                characteristic_master_data_type_master_data_type_id: sMdt,
                counter    : iNextCounter,
                operator   : sOperator,
                value_from : sFrom,
                value_to   : sTo
            });

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseStrategyValuesUpdate")
                .then(function () {
                    MessageToast.show("Criteria value added.");
                    this._loadValueCount();
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not add criteria value: " + (e.message || "Unknown error"));
                });
        },

        _updateCriteriaValue: function (oCtx, sOperator, sFrom, sTo) {
            oCtx.setProperty("operator", sOperator);
            oCtx.setProperty("value_from", sFrom);
            oCtx.setProperty("value_to", sTo);

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseStrategyValuesUpdate")
                .then(function () {
                    MessageToast.show("Criteria value updated.");
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not update criteria value: " + (e.message || "Unknown error"));
                });
        },

        onDeleteCriteriaValue: function (oEvent) {
            // Row's OWN live context — NOT a freshly manufactured
            // bindContext(). A standalone context built that way is never
            // attached to anything the model considers "live", and
            // .delete() on it can resolve successfully without ever
            // sending a real request.
            var oRowCtx = oEvent.getSource().getBindingContext();
            var sLabel  = oRowCtx.getProperty("characteristic_characteristic_id");

            MessageBox.confirm("Remove criteria \"" + sLabel + "\" from this strategy?", {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    oRowCtx.delete("$auto")
                        .then(function () {
                            MessageToast.show("Criteria value removed.");
                            this._loadValueCount();
                        }.bind(this))
                        .catch(function (e) {
                            MessageBox.error("Delete failed: " + (e.message || "Unknown error"));
                        }.bind(this));
                }.bind(this)
            });
        },

        // ── Release Codes (Steps) tab ────────────────────────────────
        // Attaches directly to the Steps table's OWN items binding (rather
        // than only calling the refresh once, eagerly, right after the
        // parent record loads) — the table's own "steps" data is a
        // separate async fetch, so this guarantees the forced refresh
        // fires after the rows have genuinely rendered, not before.
        _attachStepsTableRefresh: function () {
            var oTable = this.byId("stepsTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) {
                // Binding not created yet on first call — try again once
                // the view has finished its initial rendering pass.
                this.getView().attachEventOnce("afterRendering", function () {
                    var oB = this.byId("stepsTable").getBinding("items");
                    if (oB) {
                        oB.detachEvent("dataReceived", this._refreshStepRowFormatters, this);
                        oB.attachEvent("dataReceived", this._refreshStepRowFormatters, this);
                    }
                }, this);
                return;
            }
            oBinding.detachEvent("dataReceived", this._refreshStepRowFormatters, this);
            oBinding.attachEvent("dataReceived", this._refreshStepRowFormatters, this);
        },

        _loadStepCount: function () {
            var oTable = this.byId("stepsTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }
            var oHeaderCtx = oBinding.getHeaderContext && oBinding.getHeaderContext();
            if (oHeaderCtx) {
                oHeaderCtx.requestProperty("$count").then(function (iCount) {
                    var oView = this.getView();
                    if (!oView || oView.bIsDestroyed) { return; }
                    this._oViewModel.setProperty("/stepCount", String(iCount || 0));
                }.bind(this)).catch(function () { /* new/unsaved record — leave at 0 */ });
            }
            this._refreshStepRowFormatters();
            // Safety net: if dataReceived's timing turns out to be
            // unreliable for this particular binding, this delayed retry
            // catches it after the table has had a moment to render.
            setTimeout(this._refreshStepRowFormatters.bind(this), 400);
        },

        // Forces the Flow and Mandatory cells to re-evaluate against their
        // row's current data. These were showing stale/incorrect values
        // (e.g. every row displaying "Parallel" regardless of the real,
        // server-confirmed-correct boolean) even after switching from an
        // inline expression binding to an explicit formatter — pointing to
        // the rendered cell not being refreshed after the underlying data
        // changes, rather than a problem with the binding technique itself.
        _refreshStepRowFormatters: function () {
            var oTable = this.byId("stepsTable");
            if (!oTable) { return; }
            oTable.getItems().forEach(function (oItem) {
                var oCtx = oItem.getBindingContext();
                if (!oCtx) { return; }
                var aCells = oItem.getCells();
                // cells: [Seq, Code, Description, SLA, Flow, Mandatory, delete]
                var bParallel  = oCtx.getProperty("parallel");
                var bMandatory = oCtx.getProperty("mandatory");

                // Confirmed via live console diagnostic: the binding's own
                // formatter computes the correct value (e.g. "Sequential"
                // for parallel=false) and getValue() also already reflects
                // the correct raw value — but the control's actually
                // rendered text never gets updated to match, for reasons
                // independent of the formatter or the data. Rather than
                // continue to rely on the binding's own propagation
                // (checkUpdate didn't resolve it), set the controls
                // directly from the row's current context data.
                var oFlowStatus = aCells[4];
                if (oFlowStatus) {
                    oFlowStatus.setText(this.formatFlowText(bParallel));
                    oFlowStatus.setState(this.formatFlowState(bParallel));
                }
                var oMandatoryIcon = aCells[5];
                if (oMandatoryIcon) {
                    oMandatoryIcon.setSrc(this.formatMandatoryIcon(bMandatory));
                    oMandatoryIcon.setColor(this.formatMandatoryColor(bMandatory));
                }
            }.bind(this));

            // Same trigger point as the row-formatter refresh, since both
            // need to happen exactly when the step data changes.
            this._renderApprovalFlow();
        },

        // ── Resulting Approval Flow diagram ─────────────────────────
        // Groups the loaded steps (already sorted/available via
        // _getLoadedStepRows) into visual "stages": a Sequential step
        // always starts a new stage; a Parallel step joins the stage of
        // whatever came immediately before it. Consecutive Parallel steps
        // therefore end up grouped together in the same stage.
        _computeApprovalStages: function () {
            var aRows = this._getLoadedStepRows().slice().sort(function (a, b) {
                return a.step_number - b.step_number;
            });
            var aStages = [];
            aRows.forEach(function (oRow) {
                var oCode = {
                    seq        : oRow.step_number,
                    code       : oRow.release_code_release_code_id,
                    description: oRow.release_code ? oRow.release_code.description : ""
                };
                if (oRow.parallel && aStages.length > 0) {
                    aStages[aStages.length - 1].push(oCode);
                } else {
                    aStages.push([oCode]);
                }
            });
            return aStages;
        },

        _renderApprovalFlow: function () {
            var oContainer = this.byId("approvalFlowContainer");
            if (!oContainer) { return; }
            oContainer.removeAllItems();

            var aStages = this._computeApprovalStages();
            if (!aStages.length) {
                oContainer.addItem(new Text({
                    text: "Add release codes above to see the resulting approval flow."
                }));
                return;
            }

            aStages.forEach(function (aCodes, iIndex) {
                if (iIndex > 0) {
                    oContainer.addItem(this._buildFlowArrow("Then"));
                }
                oContainer.addItem(this._buildStageBox(aCodes));
            }.bind(this));

            oContainer.addItem(this._buildFlowArrow("All done"));
            oContainer.addItem(this._buildApprovedBox());
        },

        _buildFlowArrow: function (sLabel) {
            return new VBox({
                alignItems: "Center",
                justifyContent: "Center",
                items: [
                    new Icon({ src: "sap-icon://arrow-right", color: "Neutral", size: "1.2rem" }),
                    new Text({ text: sLabel }).addStyleClass("sapMDMFlowArrowLabel")
                ]
            }).addStyleClass("sapUiSmallMarginBeginEnd");
        },

        _buildCodeCard: function (oCode) {
            return new HBox({
                alignItems: "Center",
                items: [
                    new Avatar({
                        displaySize    : "XS",
                        initials       : String(oCode.seq).padStart(2, "0"),
                        backgroundColor: "Accent6"
                    }).addStyleClass("sapUiTinyMarginEnd"),
                    new VBox({
                        items: [
                            new Text({ text: oCode.code }).addStyleClass("sapMDMFlowCodeName"),
                            new Text({ text: oCode.description }).addStyleClass("sapMDMFlowArrowLabel")
                        ]
                    })
                ]
            }).addStyleClass("sapMDMFlowCodeCard");
        },

        _buildStageBox: function (aCodes) {
            if (aCodes.length === 1) {
                var oCode = aCodes[0];
                return new HBox({
                    alignItems: "Center",
                    items: [
                        new Avatar({
                            displaySize    : "XS",
                            initials       : String(oCode.seq).padStart(2, "0"),
                            backgroundColor: "Accent6"
                        }).addStyleClass("sapUiTinyMarginEnd"),
                        new VBox({
                            items: [
                                new Text({ text: oCode.code }).addStyleClass("sapMDMFlowCodeName"),
                                new Text({ text: oCode.description }).addStyleClass("sapMDMFlowArrowLabel")
                            ]
                        })
                    ]
                }).addStyleClass("sapMDMFlowStageSingle");
            }

            var aItems = [
                new Text({ text: "Parallel \u2014 Run Together" }).addStyleClass("sapMDMFlowStageParallelLabel")
            ];
            aCodes.forEach(function (oCode) {
                aItems.push(this._buildCodeCard(oCode));
            }.bind(this));

            return new VBox({ items: aItems }).addStyleClass("sapMDMFlowStageParallel");
        },

        _buildApprovedBox: function () {
            return new HBox({
                alignItems: "Center",
                items: [
                    new Icon({ src: "sap-icon://sys-enter-2", color: "Positive" }).addStyleClass("sapUiTinyMarginEnd"),
                    new Text({ text: "Approved" }).addStyleClass("sapMDMFlowCodeName")
                ]
            }).addStyleClass("sapMDMFlowApproved");
        },

        _getLoadedStepRows: function () {
            var oTable = this.byId("stepsTable");
            if (!oTable) { return []; }
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return []; }
            return oBinding.getAllCurrentContexts().map(function (c) { return c.getObject(); });
        },

        onAddStep: function () {
            if (this._oViewModel.getProperty("/isNew")) {
                MessageToast.show("Save the strategy first before adding release codes.");
                return;
            }
            this._openStepDialog(null);
        },

        onStepRowPress: function (oEvent) {
            this._openStepDialog(oEvent.getSource().getBindingContext());
        },

        _openStepDialog: function (oExistingCtx) {
            var bEdit = !!oExistingCtx;

            if (!this._oStepDialog) {
                var oCodeSelect = new Select({ forceSelection: false });
                var oSeqInput   = new Input({ type: "Number", placeholder: "e.g. 1", maxLength: 3 });
                var oFlowSelect = new Select({
                    selectedKey: "SEQ",
                    items: [
                        new Item({ key: "SEQ", text: "Sequential" }),
                        new Item({ key: "PAR", text: "Parallel" })
                    ]
                });
                var oMandatorySwitch = new Switch({ state: true, customTextOn: "Yes", customTextOff: "No" });

                var fnReset = function () {
                    oSeqInput.setValue("");
                    oFlowSelect.setSelectedKey("SEQ");
                    oMandatorySwitch.setState(true);
                };

                this._oStepDialog = new Dialog({
                    title  : "Add Release Code",
                    content: new SimpleForm({
                        editable: true,
                        layout  : "ResponsiveGridLayout",
                        content : [
                            new Label({ text: "Release Code", required: true }), oCodeSelect,
                            new Label({ text: "Sequence", required: true }), oSeqInput,
                            new Label({ text: "Flow" }), oFlowSelect,
                            new Label({ text: "Mandatory" }), oMandatorySwitch
                        ]
                    }),
                    beginButton: new Button({
                        text: "Add",
                        type: "Emphasized",
                        press: function () {
                            var sCodeId  = oCodeSelect.getSelectedKey();
                            var iSeq     = parseInt(oSeqInput.getValue(), 10);
                            var bParallel = oFlowSelect.getSelectedKey() === "PAR";
                            var bMandatory = oMandatorySwitch.getState();
                            var oCtxBeingEdited = this._oStepDialog._oEditingCtx;

                            if (!sCodeId) { MessageBox.error("Release Code is required."); return; }
                            if (!iSeq || iSeq < 1) { MessageBox.error("Sequence must be a positive number."); return; }

                            var iEditingSeq = oCtxBeingEdited ? oCtxBeingEdited.getProperty("step_number") : null;
                            var aExisting = this._getLoadedStepRows().filter(function (o) {
                                return o.step_number !== iEditingSeq;
                            });
                            if (aExisting.some(function (o) { return o.step_number === iSeq; })) {
                                MessageBox.error("Sequence " + iSeq + " is already used by another step.");
                                return;
                            }

                            if (oCtxBeingEdited) {
                                this._updateStep(oCtxBeingEdited, iSeq, sCodeId, bMandatory, bParallel);
                            } else {
                                this._createStep(iSeq, sCodeId, bMandatory, bParallel);
                            }

                            fnReset();
                            this._oStepDialog.close();
                        }.bind(this)
                    }),
                    endButton: new Button({
                        text: "Cancel",
                        press: function () { this._oStepDialog.close(); }.bind(this)
                    }),
                    afterClose: fnReset
                });
                this._oStepDialog._oCodeSelect       = oCodeSelect;
                this._oStepDialog._oSeqInput         = oSeqInput;
                this._oStepDialog._oFlowSelect       = oFlowSelect;
                this._oStepDialog._oMandatorySwitch  = oMandatorySwitch;
                this.getView().addDependent(this._oStepDialog);
            }

            var oCodeSelect      = this._oStepDialog._oCodeSelect;
            var oSeqInput        = this._oStepDialog._oSeqInput;
            var oFlowSelect      = this._oStepDialog._oFlowSelect;
            var oMandatorySwitch = this._oStepDialog._oMandatorySwitch;

            this._oStepDialog._oEditingCtx = oExistingCtx;

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/ReleaseCodes", null, null, [
                new Filter("active", FilterOperator.EQ, true)
            ], { $select: "release_code_id,description" })
                .requestContexts(0, Infinity).then(function (aCtx) {
                    oCodeSelect.destroyItems();
                    aCtx.forEach(function (c) {
                        oCodeSelect.addItem(new Item({
                            key : c.getProperty("release_code_id"),
                            text: c.getProperty("release_code_id") + " \u2014 " + c.getProperty("description")
                        }));
                    });

                    if (bEdit) {
                        this._oStepDialog.setTitle("Edit Release Code");
                        this._oStepDialog.getBeginButton().setText("Save");
                        oCodeSelect.setSelectedKey(oExistingCtx.getProperty("release_code_release_code_id"));
                        oSeqInput.setValue(String(oExistingCtx.getProperty("step_number")));
                        oFlowSelect.setSelectedKey(oExistingCtx.getProperty("parallel") ? "PAR" : "SEQ");
                        oMandatorySwitch.setState(!!oExistingCtx.getProperty("mandatory"));
                    } else {
                        this._oStepDialog.setTitle("Add Release Code");
                        this._oStepDialog.getBeginButton().setText("Add");
                        oCodeSelect.setSelectedKey("");
                        var aExisting = this._getLoadedStepRows();
                        var iNextSeq = aExisting.reduce(function (iMax, o) {
                            return Math.max(iMax, o.step_number || 0);
                        }, 0) + 1;
                        oSeqInput.setValue(String(iNextSeq));
                        oFlowSelect.setSelectedKey("SEQ");
                        oMandatorySwitch.setState(true);
                    }

                    this._oStepDialog.open();
                }.bind(this));
        },

        _createStep: function (iSeq, sCodeId, bMandatory, bParallel) {
            var oTable = this.byId("stepsTable");
            if (!oTable) { return; }
            var oListBinding = oTable.getBinding("items");
            if (!oListBinding) { return; }

            oListBinding.create({
                step_number: iSeq,
                release_code_release_code_id: sCodeId,
                mandatory  : bMandatory,
                parallel   : bParallel
            });

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseStrategyStepsUpdate")
                .then(function () {
                    MessageToast.show("Release code added.");
                    this._loadStepCount();
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not add release code: " + (e.message || "Unknown error"));
                });
        },

        _updateStep: function (oCtx, iSeq, sCodeId, bMandatory, bParallel) {
            // step_number is part of the key — changing it means delete +
            // recreate rather than a plain property update, since OData
            // keys generally can't be patched in place.
            var iOldSeq = oCtx.getProperty("step_number");
            if (iSeq !== iOldSeq) {
                var sOldCode = oCtx.getProperty("release_code_release_code_id");
                oCtx.delete("$auto").then(function () {
                    this._createStep(iSeq, sCodeId, bMandatory, bParallel);
                }.bind(this)).catch(function (e) {
                    MessageBox.error("Could not update sequence: " + (e.message || "Unknown error"));
                });
                return;
            }

            oCtx.setProperty("release_code_release_code_id", sCodeId);
            oCtx.setProperty("mandatory", bMandatory);
            oCtx.setProperty("parallel", bParallel);

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseStrategyStepsUpdate")
                .then(function () {
                    MessageToast.show("Release code updated.");
                    this._refreshStepRowFormatters();
                }.bind(this))
                .catch(function (e) {
                    MessageBox.error("Could not update release code: " + (e.message || "Unknown error"));
                });
        },

        onDeleteStep: function (oEvent) {
            var oRowCtx = oEvent.getSource().getBindingContext();
            var sLabel  = oRowCtx.getProperty("release_code_release_code_id");

            MessageBox.confirm("Remove release code \"" + sLabel + "\" from this strategy?", {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    oRowCtx.delete("$auto")
                        .then(function () {
                            MessageToast.show("Release code removed.");
                            this._loadStepCount();
                        }.bind(this))
                        .catch(function (e) {
                            MessageBox.error("Delete failed: " + (e.message || "Unknown error"));
                        }.bind(this));
                }.bind(this)
            });
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sId        = this.byId("inId").getValue().trim();
            var sDesc      = this.byId("inDescription").getValue().trim();
            var sAppliesTo = this.byId("selAppliesTo").getSelectedKey();
            var sPriority  = this.byId("inPriority").getValue().trim();
            var sValidFrom = this.byId("dpValidFrom").getValue();
            var bActive    = this.byId("swActive").getState();

            if (!sId) {
                MessageBox.error("Strategy ID could not be generated. Please cancel and try again.");
                return;
            }
            if (!sDesc)      { MessageBox.error("Description is required."); return; }
            if (!sAppliesTo) { MessageBox.error("Applies To is required."); return; }
            if (!sPriority || isNaN(parseInt(sPriority, 10))) { MessageBox.error("Priority must be a number."); return; }
            if (!sValidFrom) { MessageBox.error("Valid From is required."); return; }

            var iPriority = parseInt(sPriority, 10);
            this._oViewModel.setProperty("/busy", true);

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/ReleaseStrategies", null, null, [
                new Filter("master_data_type_master_data_type_id", FilterOperator.EQ, sAppliesTo),
                new Filter("priority", FilterOperator.EQ, iPriority)
            ], { $select: "strategy_id" }).requestContexts(0, Infinity).then(function (aCtx) {
                var bDuplicate = aCtx.some(function (c) {
                    return c.getProperty("strategy_id") !== sId;
                });
                if (bDuplicate) {
                    this._oViewModel.setProperty("/busy", false);
                    MessageBox.error(
                        "Priority " + iPriority + " is already used by another strategy with Applies To \"" +
                        sAppliesTo + "\". Choose a different priority."
                    );
                    return;
                }
                this._doSaveStrategy(sId, sDesc, sAppliesTo, iPriority, bActive);
            }.bind(this)).catch(function (e) {
                this._oViewModel.setProperty("/busy", false);
                MessageBox.error("Could not validate priority: " + (e.message || "Unknown error"));
            }.bind(this));
        },

        _doSaveStrategy: function (sId, sDesc, sAppliesTo, iPriority, bActive) {
            var bIsNew = this._oViewModel.getProperty("/isNew");
            var oCtx   = this.getView().getBindingContext();

            if (oCtx) {
                if (bIsNew) { oCtx.setProperty("strategy_id", sId); }
                oCtx.setProperty("description", sDesc);
                oCtx.setProperty("master_data_type_master_data_type_id", sAppliesTo);
                oCtx.setProperty("priority", iPriority);
                oCtx.setProperty("active", bActive);
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("releaseStrategyUpdate")
                .then(function () {
                    if (bIsNew && oCtx && oCtx.created) {
                        return oCtx.created().then(function () { return true; });
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Release strategy saved successfully.");

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
                    // Fallback in case the duplicate somehow slipped past the
                    // pre-check (e.g. a race with another user saving at the
                    // same instant) — surface the DB constraint clearly
                    // rather than a raw SQL error.
                    if (/unique|constraint|duplicate/i.test(sMsg)) {
                        sMsg = "Priority " + iPriority + " is already used by another strategy with this Applies To.";
                    }
                    MessageBox.error("Save failed: " + sMsg);
                }.bind(this));
        },

        // ── Cancel ───────────────────────────────────────────────────
        onCancel: function () {
            var fnGoBack = function () {
                var oModel = this.getOwnerComponent().getModel();
                oModel.resetChanges("releaseStrategyUpdate");
                try { oModel.resetChanges("releaseStrategyValuesUpdate"); } catch (e) { /* no pending */ }
                try { oModel.resetChanges("releaseStrategyStepsUpdate"); } catch (e) { /* no pending */ }
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
        // ── Formatters ───────────────────────────────────────────────
        // These replace inline {= ... } expression bindings that were
        // rendering incorrectly for the Flow column specifically (every
        // row showed "Parallel" regardless of the real, confirmed-correct
        // underlying boolean value) — explicit formatter functions are
        // more predictable than inline expressions for this kind of
        // per-row boolean-driven display, so the same pattern is applied
        // to the other similarly-built columns as a precaution.
        formatFlowText: function (bParallel) {
            return bParallel ? "Parallel" : "Sequential";
        },
        formatFlowState: function (bParallel) {
            return bParallel ? "Information" : "None";
        },
        formatMandatoryIcon: function (bMandatory) {
            return bMandatory ? "sap-icon://accept" : "sap-icon://less";
        },
        formatMandatoryColor: function (bMandatory) {
            return bMandatory ? "Positive" : "Neutral";
        },
        formatCriteriaTypeText: function (sOperator) {
            return sOperator === "BETWEEN" ? "Range" : "Single";
        },
        formatCriteriaTypeState: function (sOperator) {
            return sOperator === "BETWEEN" ? "Information" : "None";
        },
        formatCriteriaValue: function (sOperator, sFrom, sTo) {
            return sOperator === "BETWEEN" ? (sFrom + " \u2013 " + sTo) : sFrom;
        },
        formatSlaHours: function (iHours) {
            return iHours ? (iHours + " hrs") : "\u2014";
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("releaseStrategies");
        }
    });
});
